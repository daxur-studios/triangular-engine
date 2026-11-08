import { NavMinHeap } from './nav-heap';
import { NAV_CLEARANCE_THRESHOLDS, NavFlag, type NavUnitClass } from './nav-flags';
import { NAV_UNIT_CLASSES, type NavSectorGraph } from './nav-sectors';
import type { NavRect } from './nav-types';

const SQRT2 = Math.SQRT2;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

const now: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();

/**
 * One sector's share of a flow field: the integration (cost to the goal) and a quantised direction
 * for every cell of the sector. Read-only for consumers; the arrays are row-major over the sector
 * rectangle (`index = (y - rect.y) * rect.width + (x - rect.x)`).
 */
export interface NavSectorField {
  /** The sector this field covers. */
  readonly sector: number;
  /** The sector rectangle in grid cells. */
  readonly rect: NavRect;
  /** The `NavSectorGraph.versions` entry of the sector when this field was built. */
  readonly version: number;
  /** Increases with every build in a cache; identifies one concrete build. */
  readonly buildId: number;
  /**
   * The neighbouring sectors whose fields seeded this one (empty for the goal sector without a
   * re-entry). Their shared edge cells are seeded from the downstream values.
   */
  readonly downstreams: readonly number[];
  /**
   * Cost to the goal per cell: the sum of entered cell costs along the cheapest path (diagonals
   * times sqrt 2), 0 at the goal, `Infinity` where the goal is not reached through this sector.
   */
  readonly cost: Float32Array;
  /**
   * Quantised unit direction per cell, two entries `x, y` each in -127..127 (127 = 1). `0, 0`
   * means no direction: blocked, unreached, or the goal cell. Grid X is east, grid Y is south.
   */
  readonly dir: Int8Array;
  /** Wall-clock time the build took in milliseconds. */
  readonly buildMs: number;
}

/** A mutable direction vector written by the sampling methods. */
export interface NavFlowDirection {
  /** East component, at most 1 in magnitude. */
  x: number;
  /** South component, at most 1 in magnitude. */
  y: number;
}

/** Counters and timings of a {@link NavFlowCache}. */
export interface NavFlowStats {
  /** Calls of {@link NavFlowCache.ensure}. */
  requests: number;
  /** Requests that needed no build. */
  hits: number;
  /** Sector fields built (includes rebuilds after invalidation and re-entry refinements). */
  builds: number;
  /** Sector fields dropped because a sector version changed or their downstream did. */
  invalidations: number;
  /** Sector fields dropped by the LRU limit. */
  evictions: number;
  /** Sum of all build times in milliseconds. */
  totalBuildMs: number;
  /** Build time of the most recent sector field. */
  lastBuildMs: number;
  /** Longest single sector build. */
  maxBuildMs: number;
  /** Sector fields currently cached. */
  sectorFields: number;
}

/** One entry of the recent build log ({@link NavFlowCache.recentBuilds}). */
export interface NavFlowBuildRecord {
  /** The sector that was built. */
  readonly sector: number;
  /** Build time in milliseconds. */
  readonly ms: number;
  /** Goal cell index of the field. */
  readonly goalCell: number;
  /** Unit class of the field. */
  readonly unitClass: NavUnitClass;
}

/** Options for {@link NavFlowCache}. */
export interface NavFlowCacheOptions {
  /** Most sector fields kept across all goals; the least recently used go first. Default 512. */
  readonly maxSectorFields?: number;
  /** Number of build records kept in the log. Default 256. */
  readonly buildLogSize?: number;
}

/** Result of {@link NavFlowCache.ensure}. */
export interface NavFlowEnsureResult {
  /**
   * `ready`: the start cell has a direction. `partial`: the build budget ran out, call again.
   * `unreachable`: the goal cannot be reached from the start cell for this class.
   */
  readonly status: 'ready' | 'partial' | 'unreachable';
  /** Sector fields built by this call. */
  readonly built: number;
}

interface SectorEntry extends NavSectorField {
  lastUsed: number;
  stale: boolean;
  owner: NavFlowField;
}

/**
 * The flow field of one (goal cell, unit class) pair: a sparse set of {@link NavSectorField}s, one
 * per built sector. Get one from {@link NavFlowCache.field}; fill it with {@link NavFlowCache.ensure}.
 * Sampling returns "no direction" in sectors that are not built yet.
 */
export class NavFlowField {
  /** The goal column. */
  readonly goalX: number;
  /** The goal row. */
  readonly goalY: number;
  /** The goal cell index. */
  readonly goalCell: number;
  /** The unit class the field is built for. */
  readonly unitClass: NavUnitClass;
  /** The built sector fields, indexed by sector (`undefined` = not built, evicted or invalidated). */
  readonly sectors: (NavSectorField | undefined)[];

  /** @internal Start cells known to be unreachable (cleared when any sector version changes). */
  readonly failed = new Set<number>();
  /** @internal */
  builtCount = 0;

  private readonly width: number;
  private readonly height: number;
  private readonly sectorSize: number;
  private readonly sectorsX: number;

  constructor(
    readonly graph: NavSectorGraph,
    goalX: number,
    goalY: number,
    unitClass: NavUnitClass,
  ) {
    this.goalX = goalX;
    this.goalY = goalY;
    this.unitClass = unitClass;
    this.width = graph.grid.width;
    this.height = graph.grid.height;
    this.goalCell = goalY * this.width + goalX;
    this.sectorSize = graph.sectorSize;
    this.sectorsX = graph.sectorsX;
    this.sectors = new Array<NavSectorField | undefined>(graph.sectorCount).fill(undefined);
  }

  /** Number of sectors with a built field. */
  get builtSectors(): number {
    return this.builtCount;
  }

  /**
   * The cost to the goal at a cell, or `Infinity` when its sector is not built or the cell does
   * not reach the goal.
   */
  costAtCell(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return Infinity;
    const e = this.sectors[this.sectorIndex(x, y)];
    if (!e) return Infinity;
    return e.cost[(y - e.rect.y) * e.rect.width + (x - e.rect.x)];
  }

  /**
   * The stored direction of one cell, as a vector of length 1 (up to quantisation). Returns false
   * (leaving `out` untouched) where the cell has none.
   */
  directionAtCell(x: number, y: number, out: NavFlowDirection): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    const e = this.sectors[this.sectorIndex(x, y)];
    if (!e) return false;
    const l = ((y - e.rect.y) * e.rect.width + (x - e.rect.x)) * 2;
    const dx = e.dir[l];
    const dy = e.dir[l + 1];
    if (dx === 0 && dy === 0) return false;
    out.x = dx / 127;
    out.y = dy / 127;
    return true;
  }

  /**
   * Bilinear direction at a continuous position in cell units (cell `i` covers `[i, i + 1)`, its
   * centre is `i + 0.5`). The four surrounding cell centres are blended; cells without a direction
   * (blocked, unreached, in an unbuilt sector, outside the grid) are left out and the remaining
   * weights renormalised, so the result never leans toward a wall. The vector has length at most 1.
   * Returns false when none of the four cells has a direction.
   */
  sample(px: number, py: number, out: NavFlowDirection): boolean {
    const gx = px - 0.5;
    const gy = py - 0.5;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;
    let sx = 0;
    let sy = 0;
    let sw = 0;
    for (let j = 0; j < 2; j++) {
      const wy = j === 0 ? 1 - fy : fy;
      const cy = y0 + j;
      if (wy <= 0 || cy < 0 || cy >= this.height) continue;
      for (let i = 0; i < 2; i++) {
        const w = (i === 0 ? 1 - fx : fx) * wy;
        const cx = x0 + i;
        if (w <= 0 || cx < 0 || cx >= this.width) continue;
        const e = this.sectors[this.sectorIndex(cx, cy)];
        if (!e) continue;
        const l = ((cy - e.rect.y) * e.rect.width + (cx - e.rect.x)) * 2;
        const dx = e.dir[l];
        const dy = e.dir[l + 1];
        if (dx === 0 && dy === 0) continue;
        sx += w * dx;
        sy += w * dy;
        sw += w;
      }
    }
    if (sw <= 1e-6) return false;
    out.x = sx / (sw * 127);
    out.y = sy / (sw * 127);
    return true;
  }

  private sectorIndex(x: number, y: number): number {
    return Math.floor(y / this.sectorSize) * this.sectorsX + Math.floor(x / this.sectorSize);
  }
}

/**
 * Builds and caches lazy flow fields on a {@link NavSectorGraph}.
 *
 * A flow field exists per (goal cell, unit class) and is made of per-sector pieces. Pieces are built
 * only where an agent needs them: {@link NavFlowCache.ensure} runs the abstract path query from the
 * agent's cell, takes the sector corridor, and builds the missing sectors from the goal end back.
 * Each sector is a multi-source Dijkstra over the composed `cost` layer (8-neighbour, diagonals
 * cost sqrt 2, no corner cutting, passability by clearance for the class), seeded from the goal (in
 * the goal sector) and from the **whole shared edge** of the downstream sector's already-built field.
 * Seeding the whole edge instead of the portal cell means agents spread along the edge rather than
 * funnel to one point, which matters because a run of open edge has a single portal.
 *
 * Every piece records the `NavSectorGraph.versions` entry it was built from. {@link NavFlowCache.sync}
 * drops pieces whose sector was rebuilt, and (transitively) pieces seeded from a dropped one; they are
 * rebuilt lazily on the next `ensure`. A global LRU limit bounds the memory: about 24 KB per 64 x 64
 * sector (4 bytes of cost plus 2 of direction per cell).
 *
 * A sector is built once per field with the downstream neighbour of the first corridor that needed
 * it. If a corridor leaves a sector and re-enters it (a wall splitting a sector, say), the sector is
 * rebuilt seeded from both downstream neighbours.
 *
 * No Angular or three.js dependency.
 */
export class NavFlowCache {
  /** Counters and timings; updated in place. */
  readonly stats: NavFlowStats = {
    requests: 0,
    hits: 0,
    builds: 0,
    invalidations: 0,
    evictions: 0,
    totalBuildMs: 0,
    lastBuildMs: 0,
    maxBuildMs: 0,
    sectorFields: 0,
  };
  /** The most recent builds, oldest first, at most `buildLogSize` entries. */
  readonly recentBuilds: NavFlowBuildRecord[] = [];
  /** The sector graph the fields are built on. */
  readonly graph: NavSectorGraph;
  /** The configured LRU limit. */
  readonly maxSectorFields: number;

  private readonly buildLogSize: number;
  private readonly fields = new Map<number, NavFlowField>();
  private readonly entries = new Set<SectorEntry>();
  private readonly seen: Uint32Array;
  private clock = 0;
  private buildCounter = 0;

  private readonly heap = new NavMinHeap();
  private readonly done: Uint8Array;

  constructor(graph: NavSectorGraph, options: NavFlowCacheOptions = {}) {
    this.graph = graph;
    this.maxSectorFields = Math.max(1, Math.floor(options.maxSectorFields ?? 512));
    this.buildLogSize = Math.max(0, Math.floor(options.buildLogSize ?? 256));
    this.seen = Uint32Array.from(graph.versions);
    this.done = new Uint8Array(graph.sectorSize * graph.sectorSize);
  }

  /**
   * The (initially empty) flow field of a goal cell and unit class; the same object for the same
   * key while it holds any built sector. Does not build anything.
   */
  field(goalX: number, goalY: number, unitClass: NavUnitClass): NavFlowField {
    const key = (goalY * this.graph.grid.width + goalX) * 3 + NAV_UNIT_CLASSES.indexOf(unitClass);
    let f = this.fields.get(key);
    if (!f) {
      f = new NavFlowField(this.graph, goalX, goalY, unitClass);
      this.fields.set(key, f);
    }
    return f;
  }

  /** Marks every built sector of a field as recently used (call per frame for fields in use). */
  touch(field: NavFlowField): void {
    const t = ++this.clock;
    for (const e of field.sectors) if (e) (e as SectorEntry).lastUsed = t;
  }

  /**
   * Drops sector fields that are out of date: built from a sector version that has since changed,
   * or seeded from such a field. Call after `NavSectorGraph.rebuildSectors` (the crowd and
   * {@link NavFlowCache.ensure} call it for you). Returns the number of fields dropped.
   */
  sync(): number {
    const versions = this.graph.versions;
    const seen = this.seen;
    let changed = false;
    for (let s = 0; s < versions.length; s++) {
      if (versions[s] !== seen[s]) {
        changed = true;
        seen[s] = versions[s];
      }
    }
    if (!changed) return 0;
    for (const e of this.entries) e.stale = e.version !== versions[e.sector];
    for (let more = true; more; ) {
      more = false;
      for (const e of this.entries) {
        if (e.stale) continue;
        for (const d of e.downstreams) {
          const de = e.owner.sectors[d] as SectorEntry | undefined;
          if (de && de.stale) {
            e.stale = true;
            more = true;
            break;
          }
        }
      }
    }
    let dropped = 0;
    for (const e of [...this.entries]) {
      if (e.stale) {
        this.remove(e);
        dropped++;
      }
    }
    for (const f of this.fields.values()) f.failed.clear();
    this.stats.invalidations += dropped;
    return dropped;
  }

  /**
   * Makes sure the field has a direction at the start cell, building the missing sector fields along
   * the abstract corridor from the goal end back. Fields that are current are reused (a hit).
   *
   * `maxBuilds` caps the sector fields built by this call; when it runs out the status is `partial`
   * and the next call continues. The start cell must be inside the grid.
   */
  ensure(field: NavFlowField, fromX: number, fromY: number, maxBuilds = Infinity): NavFlowEnsureResult {
    this.sync();
    const stats = this.stats;
    stats.requests++;
    const graph = this.graph;
    const grid = graph.grid;
    const fromCell = fromY * grid.width + fromX;
    if (field.failed.has(fromCell)) return { status: 'unreachable', built: 0 };
    const hasDirection = (): boolean => {
      const e = field.sectors[graph.sectorOf(fromX, fromY)];
      return !!e && e.cost[(fromY - e.rect.y) * e.rect.width + (fromX - e.rect.x)] !== Infinity;
    };
    if (hasDirection()) {
      stats.hits++;
      this.touchSector(field, graph.sectorOf(fromX, fromY));
      return { status: 'ready', built: 0 };
    }
    const path = graph.findAbstractPath(fromX, fromY, field.goalX, field.goalY, field.unitClass);
    if (!path.found) {
      field.failed.add(fromCell);
      return { status: 'unreachable', built: 0 };
    }
    const secs = path.sectors;
    const goalSector = secs[secs.length - 1];
    const visited = new Set<number>();
    let built = 0;
    for (let i = secs.length - 1; i >= 0; i--) {
      const s = secs[i];
      const d = i === secs.length - 1 ? -1 : secs[i + 1];
      const reentry = visited.has(s);
      visited.add(s);
      const existing = field.sectors[s];
      let downstreams: number[] = [];
      if (existing) {
        const missing = d !== -1 && !existing.downstreams.includes(d);
        const refine = missing && (reentry || (i === 0 && !hasDirection()));
        if (!refine) {
          this.touchSector(field, s);
          continue;
        }
        downstreams = existing.downstreams.filter((x) => field.sectors[x] !== undefined);
      }
      if (d !== -1) {
        if (!field.sectors[d]) return { status: 'partial', built };
        downstreams.push(d);
      }
      if (built >= maxBuilds) return { status: 'partial', built };
      this.buildSector(field, s, downstreams, s === goalSector);
      built++;
    }
    if (built === 0) stats.hits++;
    if (!hasDirection()) {
      field.failed.add(fromCell);
      return { status: 'unreachable', built };
    }
    return { status: 'ready', built };
  }

  /** The cached sector fields of every goal, for inspection and tests. */
  get cachedFields(): number {
    return this.entries.size;
  }

  private touchSector(field: NavFlowField, s: number): void {
    const e = field.sectors[s] as SectorEntry | undefined;
    if (e) e.lastUsed = ++this.clock;
  }

  private remove(e: SectorEntry): void {
    this.entries.delete(e);
    const owner = e.owner;
    if (owner.sectors[e.sector] === e) {
      owner.sectors[e.sector] = undefined;
      owner.builtCount--;
    }
    this.stats.sectorFields = this.entries.size;
    if (owner.builtCount === 0) {
      const key = owner.goalCell * 3 + NAV_UNIT_CLASSES.indexOf(owner.unitClass);
      if (this.fields.get(key) === owner) this.fields.delete(key);
    }
  }

  private register(field: NavFlowField, entry: SectorEntry): void {
    const old = field.sectors[entry.sector] as SectorEntry | undefined;
    if (old) this.remove(old);
    const key = field.goalCell * 3 + NAV_UNIT_CLASSES.indexOf(field.unitClass);
    if (!this.fields.has(key)) this.fields.set(key, field);
    field.sectors[entry.sector] = entry;
    field.builtCount++;
    this.entries.add(entry);
    while (this.entries.size > this.maxSectorFields) {
      let oldest: SectorEntry | undefined;
      for (const e of this.entries) {
        if (e !== entry && (!oldest || e.lastUsed < oldest.lastUsed)) oldest = e;
      }
      if (!oldest) break;
      this.remove(oldest);
      this.stats.evictions++;
    }
    this.stats.sectorFields = this.entries.size;
  }

  /**
   * Builds one sector field. `downstreams` are neighbouring sectors whose fields already exist in
   * `field`; the goal sector also seeds the goal cell.
   */
  private buildSector(field: NavFlowField, sector: number, downstreams: number[], isGoalSector: boolean): void {
    const t0 = now();
    const graph = this.graph;
    const grid = graph.grid;
    const { flags, clearance, cost, width: W, height: H } = grid;
    const threshold = NAV_CLEARANCE_THRESHOLDS[field.unitClass];
    const pass = (i: number): boolean => (flags[i] & NavFlag.BLOCKED) === 0 && clearance[i] >= threshold;
    const rect = graph.sectorRect(sector);
    const { x: x0, y: y0, width: sw, height: sh } = rect;
    const area = sw * sh;
    const dist = new Float32Array(area).fill(Infinity);
    const done = this.done;
    done.fill(0, 0, area);
    const heap = this.heap;
    heap.clear();
    const down: SectorEntry[] = [];
    for (const d of downstreams) {
      const de = field.sectors[d] as SectorEntry | undefined;
      if (de) down.push(de);
    }

    // Seeds.
    if (isGoalSector) {
      dist[(field.goalY - y0) * sw + (field.goalX - x0)] = 0;
      heap.push(0, (field.goalY - y0) * sw + (field.goalX - x0));
    }
    for (const de of down) {
      const r = de.rect;
      let ex0 = x0;
      let ex1 = x0 + sw - 1;
      let ey0 = y0;
      let ey1 = y0 + sh - 1;
      if (r.x === x0 + sw) ex0 = ex1;
      else if (r.x + r.width === x0) ex1 = ex0;
      else if (r.y === y0 + sh) ey0 = ey1;
      else ey1 = ey0;
      for (let y = ey0; y <= ey1; y++) {
        for (let x = ex0; x <= ex1; x++) {
          const ci = y * W + x;
          if (!pass(ci)) continue;
          let best = Infinity;
          for (let k = 0; k < 8; k++) {
            const nx = x + DX[k];
            const ny = y + DY[k];
            if (nx < r.x || ny < r.y || nx >= r.x + r.width || ny >= r.y + r.height) continue;
            const ni = ny * W + nx;
            if (!pass(ni)) continue;
            if (k >= 4 && (!pass(y * W + nx) || !pass(ny * W + x))) continue;
            const base = de.cost[(ny - r.y) * r.width + (nx - r.x)];
            if (base === Infinity) continue;
            const v = base + cost[ni] * (k >= 4 ? SQRT2 : 1);
            if (v < best) best = v;
          }
          const l = (y - y0) * sw + (x - x0);
          if (best < dist[l]) {
            dist[l] = best;
            heap.push(best, l);
          }
        }
      }
    }

    // Dijkstra: the cost of a cell is its distance to the goal; stepping from a settled cell u to a
    // neighbour v charges the cost of entering u.
    while (heap.size > 0) {
      const lu = heap.pop();
      if (done[lu] === 1) continue;
      done[lu] = 1;
      const du = dist[lu];
      const ux = x0 + (lu % sw);
      const uy = y0 + ((lu / sw) | 0);
      const cu = cost[uy * W + ux];
      for (let k = 0; k < 8; k++) {
        const nx = ux + DX[k];
        const ny = uy + DY[k];
        if (nx < x0 || ny < y0 || nx >= x0 + sw || ny >= y0 + sh) continue;
        const ln = (ny - y0) * sw + (nx - x0);
        if (done[ln] === 1 || !pass(ny * W + nx)) continue;
        if (k >= 4 && (!pass(uy * W + nx) || !pass(ny * W + ux))) continue;
        const nd = du + cu * (k >= 4 ? SQRT2 : 1);
        if (nd < dist[ln]) {
          dist[ln] = nd;
          heap.push(nd, ln);
        }
      }
    }

    // Directions: the sum of the downhill gradient components over the passable neighbours, which
    // reads values from this sector and from the downstream fields across the shared edge.
    const dir = new Int8Array(area * 2);
    const valueAt = (x: number, y: number): number => {
      if (x >= x0 && y >= y0 && x < x0 + sw && y < y0 + sh) return dist[(y - y0) * sw + (x - x0)];
      for (const de of down) {
        const r = de.rect;
        if (x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height) {
          return de.cost[(y - r.y) * r.width + (x - r.x)];
        }
      }
      return Infinity;
    };
    for (let ly = 0; ly < sh; ly++) {
      for (let lx = 0; lx < sw; lx++) {
        const l = ly * sw + lx;
        const du = dist[l];
        if (du === Infinity || du === 0) continue;
        const x = x0 + lx;
        const y = y0 + ly;
        let gx = 0;
        let gy = 0;
        for (let k = 0; k < 8; k++) {
          const nx = x + DX[k];
          const ny = y + DY[k];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || !pass(ny * W + nx)) continue;
          if (k >= 4 && (!pass(y * W + nx) || !pass(ny * W + x))) continue;
          const gain = du - valueAt(nx, ny);
          if (!(gain > 0)) continue;
          const len = k >= 4 ? SQRT2 : 1;
          const w = gain / (len * len);
          gx += w * DX[k];
          gy += w * DY[k];
        }
        const mag = Math.sqrt(gx * gx + gy * gy);
        if (mag > 0) {
          dir[l * 2] = Math.round((gx / mag) * 127);
          dir[l * 2 + 1] = Math.round((gy / mag) * 127);
        }
      }
    }

    const ms = now() - t0;
    const entry: SectorEntry = {
      sector,
      rect,
      version: graph.versions[sector],
      buildId: ++this.buildCounter,
      downstreams: down.map((d) => d.sector),
      cost: dist,
      dir,
      buildMs: ms,
      lastUsed: ++this.clock,
      stale: false,
      owner: field,
    };
    const stats = this.stats;
    stats.builds++;
    stats.totalBuildMs += ms;
    stats.lastBuildMs = ms;
    if (ms > stats.maxBuildMs) stats.maxBuildMs = ms;
    if (this.buildLogSize > 0) {
      if (this.recentBuilds.length >= this.buildLogSize) this.recentBuilds.shift();
      this.recentBuilds.push({ sector, ms, goalCell: field.goalCell, unitClass: field.unitClass });
    }
    this.register(field, entry);
  }
}
