import { NavMinHeap } from './nav-heap';
import {
  NAV_BASE_TERRAIN_COST,
  NAV_CLEARANCE_THRESHOLDS,
  NavFlag,
  type NavUnitClass,
} from './nav-flags';
import type { NavGrid } from './nav-grid';
import type { NavRect } from './nav-types';

/** Unit classes in the order the sector graph stores them. */
export const NAV_UNIT_CLASSES: readonly NavUnitClass[] = ['villager', 'catapult', 'creature'];

/** Options for {@link NavSectorGraph.build}. */
export interface NavSectorOptions {
  /** Cells along each side of a sector. Default 64. Edge sectors may be smaller. */
  readonly sectorSize?: number;
}

/**
 * A portal: a maximal run of cell pairs along a shared sector edge where both cells of every pair
 * are passable for one unit class. The run is represented by its centre pair, `cellA` in the
 * sector with the lower index and `cellB` in its right (east) or lower (south) neighbour.
 */
export interface NavPortal {
  /** Stable id within one unit class; ids of removed portals are reused. */
  readonly id: number;
  /** The sector holding `cellA` (the west or north sector). */
  readonly sectorA: number;
  /** The sector holding `cellB` (the east or south sector). */
  readonly sectorB: number;
  /** Cell index (`y * width + x`) of the transition cell inside `sectorA`. */
  readonly cellA: number;
  /** Cell index of the transition cell inside `sectorB`. */
  readonly cellB: number;
  /** Column of `cellA`. */
  readonly ax: number;
  /** Row of `cellA`. */
  readonly ay: number;
  /** Column of `cellB`. */
  readonly bx: number;
  /** Row of `cellB`. */
  readonly by: number;
}

/**
 * A directed intra-sector link of the portal graph, inspection only: the cheapest path cost
 * inside `sector` from the portal-side cell `fromCell` to `toCell`.
 */
export interface NavPortalLink {
  /** The sector the path stays inside. */
  readonly sector: number;
  /** Start cell index (a portal transition cell in `sector`). */
  readonly fromCell: number;
  /** End cell index (a portal transition cell in `sector`). */
  readonly toCell: number;
  /** Path cost (sum of entered cell costs, diagonals times sqrt 2). */
  readonly cost: number;
}

/** Result of {@link NavSectorGraph.findAbstractPath}. */
export interface NavAbstractPath {
  /** True when the goal is reachable for the class. */
  readonly found: boolean;
  /** Estimated path cost (portal-graph cost, `Infinity` when not found). */
  readonly cost: number;
  /**
   * The ordered sector corridor from the start sector to the goal sector. Consecutive entries are
   * neighbouring sectors. Only consecutive duplicates are removed: a path may leave a sector and
   * re-enter it later, in which case it appears twice.
   */
  readonly sectors: readonly number[];
  /** The portals crossed, in order. */
  readonly portals: readonly NavPortal[];
}

/** Why a query did not find a path (diagnostics, mostly for tests and the demo). */
export type NavAbstractFailure = 'start-blocked' | 'goal-blocked' | 'disconnected';

interface ClassData {
  readonly threshold: number;
  // Portal pool (structure of arrays). Ids are recycled through `free`.
  cellA: Int32Array;
  cellB: Int32Array;
  sectorA: Int32Array;
  sectorB: Int32Array;
  poolSize: number;
  readonly free: number[];
  // Portal ids on the east / south edge of each sector, ordered along the edge.
  readonly east: number[][];
  readonly south: number[][];
  // Node ids (`portalId * 2 + side`) in each sector and the n x n intra cost matrix (row = from).
  readonly secNodes: Int32Array[];
  readonly secCost: Float32Array[];
  // Connected component id per node (portal graph, undirected).
  comp: Int32Array;
  // Abstract search scratch.
  g: Float64Array;
  pred: Int32Array;
  stamp: Int32Array;
  stampCounter: number;
}

const SQRT2 = Math.SQRT2;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

/**
 * A hierarchical (HPA*-style) abstraction of a {@link NavGrid}: the grid is cut into square sectors
 * (64 cells by default), and for every unit class the shared sector edges get portals. An abstract
 * query runs A* over the portal graph and returns the corridor of sectors a path crosses; a later
 * phase builds flow fields only in those sectors.
 *
 * Per unit class (villager, catapult, creature; see `NAV_CLEARANCE_THRESHOLDS`):
 * - A **portal** is a maximal run of cell pairs along a sector edge where both cells are passable
 *   for the class (not BLOCKED and clearance at or above the threshold). Each run gets one portal at
 *   its centre pair. A 2-cell gap gives a villager portal and no catapult or creature portal.
 * - Each portal is two **nodes** (one cell in each sector) joined by a crossing edge.
 * - Inside a sector, nodes that can reach each other are joined by edges weighted with the cheapest
 *   path over the composed `cost` layer, with the search restricted to the sector (a path that
 *   would leave a sector and come back is not considered).
 *
 * Costs follow the grid: stepping into a cell costs its `cost`, diagonal steps cost sqrt 2 times
 * that, and a diagonal step needs both orthogonal neighbours passable. Territory and faction costs
 * are not applied yet.
 *
 * Edits: pass the rectangle returned by a `NavGrid` edit method to {@link rebuildSectors}. Only the
 * sectors it touches (and neighbours whose shared portals changed) are recomputed, and their
 * `versions` entries increase. The result equals a full rebuild.
 *
 * No Angular or three.js dependency; all state lives in typed arrays.
 */
export class NavSectorGraph {
  /** The grid the graph abstracts. Read live: call {@link rebuildSectors} after edits. */
  readonly grid: NavGrid;
  /** Cells along a full sector side. */
  readonly sectorSize: number;
  /** Sectors along X. */
  readonly sectorsX: number;
  /** Sectors along Y. */
  readonly sectorsY: number;
  /** `sectorsX * sectorsY`; sectors are indexed row-major (`sy * sectorsX + sx`). */
  readonly sectorCount: number;
  /** Per-sector rebuild counter. A full build sets every entry to 1; a rebuild bumps rebuilt sectors only. */
  readonly versions: Uint32Array;

  private readonly classes: Record<NavUnitClass, ClassData>;
  private readonly minCost: number;

  // Local (per-sector) search scratch.
  private readonly lDist: Float32Array;
  private readonly lDone: Uint8Array;
  private readonly lMark: Uint8Array;
  private readonly lLabel: Int32Array;
  private readonly lQueue: Int32Array;
  private readonly heap = new NavMinHeap();
  private readonly aHeap = new NavMinHeap();

  private constructor(grid: NavGrid, sectorSize: number) {
    if (!Number.isInteger(sectorSize) || sectorSize < 2) {
      throw new Error('NavSectorGraph: sectorSize must be an integer of at least 2');
    }
    this.grid = grid;
    this.sectorSize = sectorSize;
    this.sectorsX = Math.ceil(grid.width / sectorSize);
    this.sectorsY = Math.ceil(grid.height / sectorSize);
    this.sectorCount = this.sectorsX * this.sectorsY;
    this.versions = new Uint32Array(this.sectorCount);
    this.minCost = Math.max(1, Math.floor(NAV_BASE_TERRAIN_COST * grid.roadMinFactor));
    const area = sectorSize * sectorSize;
    this.lDist = new Float32Array(area);
    this.lDone = new Uint8Array(area);
    this.lMark = new Uint8Array(area);
    this.lLabel = new Int32Array(area);
    this.lQueue = new Int32Array(area);
    const make = (unitClass: NavUnitClass): ClassData => ({
      threshold: NAV_CLEARANCE_THRESHOLDS[unitClass],
      cellA: new Int32Array(64),
      cellB: new Int32Array(64),
      sectorA: new Int32Array(64),
      sectorB: new Int32Array(64),
      poolSize: 0,
      free: [],
      east: Array.from({ length: this.sectorCount }, () => []),
      south: Array.from({ length: this.sectorCount }, () => []),
      secNodes: new Array<Int32Array>(this.sectorCount).fill(new Int32Array(0)),
      secCost: new Array<Float32Array>(this.sectorCount).fill(new Float32Array(0)),
      comp: new Int32Array(0),
      g: new Float64Array(0),
      pred: new Int32Array(0),
      stamp: new Int32Array(0),
      stampCounter: 0,
    });
    this.classes = { villager: make('villager'), catapult: make('catapult'), creature: make('creature') };
  }

  /** Builds the portals and intra-sector links of every sector for every unit class. */
  static build(grid: NavGrid, options: NavSectorOptions = {}): NavSectorGraph {
    const graph = new NavSectorGraph(grid, options.sectorSize ?? 64);
    graph.rebuildSectors(grid.bounds());
    return graph;
  }

  /** The sector index containing a cell (cell must be inside the grid). */
  sectorOf(x: number, y: number): number {
    return Math.floor(y / this.sectorSize) * this.sectorsX + Math.floor(x / this.sectorSize);
  }

  /** The cell rectangle of a sector (clipped to the grid for partial edge sectors). */
  sectorRect(sector: number): NavRect {
    const sx = sector % this.sectorsX;
    const sy = (sector - sx) / this.sectorsX;
    const x = sx * this.sectorSize;
    const y = sy * this.sectorSize;
    return {
      x,
      y,
      width: Math.min(this.sectorSize, this.grid.width - x),
      height: Math.min(this.sectorSize, this.grid.height - y),
    };
  }

  /** Indices of the sectors that a cell rectangle overlaps (clipped to the grid), row-major. */
  sectorsTouching(rect: NavRect): number[] {
    const x0 = Math.max(0, rect.x);
    const y0 = Math.max(0, rect.y);
    const x1 = Math.min(this.grid.width, rect.x + rect.width);
    const y1 = Math.min(this.grid.height, rect.y + rect.height);
    const out: number[] = [];
    if (x1 <= x0 || y1 <= y0) return out;
    const sx0 = Math.floor(x0 / this.sectorSize);
    const sx1 = Math.floor((x1 - 1) / this.sectorSize);
    const sy0 = Math.floor(y0 / this.sectorSize);
    const sy1 = Math.floor((y1 - 1) / this.sectorSize);
    for (let sy = sy0; sy <= sy1; sy++) for (let sx = sx0; sx <= sx1; sx++) out.push(sy * this.sectorsX + sx);
    return out;
  }

  /**
   * Recomputes portals and intra-sector links for the sectors a rectangle touches, for every unit
   * class, and for neighbouring sectors whose shared edge portals changed. Pass the rectangle that a
   * `NavGrid` edit method returned (it already includes the clearance halo). Bumps `versions` of
   * every rebuilt sector and returns their indices in ascending order.
   */
  rebuildSectors(dirty: NavRect): number[] {
    const touched = this.sectorsTouching(dirty);
    const rebuilt = new Set<number>();
    for (const unitClass of NAV_UNIT_CLASSES) {
      const cd = this.classes[unitClass];
      const dirtySectors = new Set<number>(touched);
      for (const s of touched) {
        const sx = s % this.sectorsX;
        const sy = (s - sx) / this.sectorsX;
        // The four edges of the sector: own east and south, and the neighbours' east / south.
        const edges: [boolean, number][] = [
          [true, s],
          [false, s],
        ];
        if (sx > 0) edges.push([true, s - 1]);
        if (sy > 0) edges.push([false, s - this.sectorsX]);
        for (const [east, owner] of edges) {
          if (this.updateEdge(cd, east, owner)) {
            dirtySectors.add(owner);
            dirtySectors.add(east ? owner + 1 : owner + this.sectorsX);
          }
        }
      }
      for (const s of dirtySectors) {
        this.rebuildIntra(cd, s);
        rebuilt.add(s);
      }
      this.computeComponents(cd);
    }
    const out = [...rebuilt].sort((a, b) => a - b);
    for (const s of out) this.versions[s]++;
    return out;
  }

  /** Number of portals for a unit class. */
  portalCount(unitClass: NavUnitClass): number {
    const cd = this.classes[unitClass];
    let n = 0;
    for (let s = 0; s < this.sectorCount; s++) n += cd.east[s].length + cd.south[s].length;
    return n;
  }

  /** All portals of a unit class (a fresh array; for overlays, tests and inspection). */
  getPortals(unitClass: NavUnitClass): NavPortal[] {
    const cd = this.classes[unitClass];
    const out: NavPortal[] = [];
    for (let s = 0; s < this.sectorCount; s++) {
      for (const id of cd.east[s]) out.push(this.portalOf(cd, id));
      for (const id of cd.south[s]) out.push(this.portalOf(cd, id));
    }
    return out;
  }

  /** The portals on the edge between a sector and its east (or south) neighbour. */
  getEdgePortals(unitClass: NavUnitClass, sector: number, edge: 'east' | 'south'): NavPortal[] {
    const cd = this.classes[unitClass];
    return (edge === 'east' ? cd.east[sector] : cd.south[sector]).map((id) => this.portalOf(cd, id));
  }

  /** All finite intra-sector links of a unit class (excluding self links), for inspection. */
  getLinks(unitClass: NavUnitClass): NavPortalLink[] {
    const cd = this.classes[unitClass];
    const out: NavPortalLink[] = [];
    for (let s = 0; s < this.sectorCount; s++) {
      const nodes = cd.secNodes[s];
      const n = nodes.length;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const c = cd.secCost[s][i * n + j];
          if (i !== j && c !== Infinity) {
            out.push({ sector: s, fromCell: this.nodeCell(cd, nodes[i]), toCell: this.nodeCell(cd, nodes[j]), cost: c });
          }
        }
      }
    }
    return out;
  }

  /**
   * An abstract path query: finds the cheapest route from a start cell to a goal cell for a unit
   * class over the portal graph, and returns the corridor of sectors and the portals it crosses.
   * The start and goal are connected to the portals of their own sectors for this query only.
   * Unreachable goals return `found: false` without searching the portal graph when the portal
   * graph's connected components prove it. The cost is the base composed cost (no territory).
   */
  findAbstractPath(
    startX: number,
    startY: number,
    goalX: number,
    goalY: number,
    unitClass: NavUnitClass,
  ): NavAbstractPath & { readonly failure?: NavAbstractFailure } {
    const grid = this.grid;
    const none = (failure: NavAbstractFailure) => ({
      found: false,
      cost: Infinity,
      sectors: [] as number[],
      portals: [] as NavPortal[],
      failure,
    });
    if (!grid.isPassable(startX, startY, unitClass)) return none('start-blocked');
    if (!grid.isPassable(goalX, goalY, unitClass)) return none('goal-blocked');
    const cd = this.classes[unitClass];
    const W = grid.width;
    const startCell = startY * W + startX;
    const goalCell = goalY * W + goalX;
    const sS = this.sectorOf(startX, startY);
    const sG = this.sectorOf(goalX, goalY);

    // Connect the start (forward search) and the goal (reverse search) to the portals of their sectors.
    const sNodes = cd.secNodes[sS];
    const gNodes = cd.secNodes[sG];
    const sCells = Array.from(sNodes, (n) => this.nodeCell(cd, n));
    const gCells = Array.from(gNodes, (n) => this.nodeCell(cd, n));
    if (sS === sG) sCells.push(goalCell);
    this.localSearch(cd.threshold, sS, startCell, false, sCells);
    const rS = this.sectorRect(sS);
    const startDist = sCells.map((c) => this.lDist[(Math.floor(c / W) - rS.y) * rS.width + (c % W) - rS.x]);
    let direct = Infinity;
    if (sS === sG) direct = startDist.pop() as number;
    this.localSearch(cd.threshold, sG, goalCell, true, gCells);
    const rG = this.sectorRect(sG);
    const goalDist = gCells.map((c) => this.lDist[(Math.floor(c / W) - rG.y) * rG.width + (c % W) - rG.x]);

    // Components: fail fast when no reachable start node shares a component with a goal node.
    const startComps = new Set<number>();
    for (let k = 0; k < sNodes.length; k++) if (startDist[k] !== Infinity) startComps.add(cd.comp[sNodes[k]]);
    const toGoal = new Map<number, number>();
    let shared = false;
    for (let k = 0; k < gNodes.length; k++) {
      if (goalDist[k] === Infinity) continue;
      toGoal.set(gNodes[k], goalDist[k]);
      if (startComps.has(cd.comp[gNodes[k]])) shared = true;
    }
    if (!shared && direct === Infinity) return none('disconnected');

    this.ensureScratch(cd);
    const stampId = ++cd.stampCounter;
    const { g, pred, stamp } = cd;
    const heap = this.aHeap;
    heap.clear();
    const minCost = this.minCost;
    const hx = goalX;
    const hy = goalY;
    const h = (node: number): number => {
      const c = this.nodeCell(cd, node);
      const dx = Math.abs((c % W) - hx);
      const dy = Math.abs(Math.floor(c / W) - hy);
      return (Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy)) * minCost;
    };
    for (let k = 0; k < sNodes.length; k++) {
      if (startDist[k] === Infinity) continue;
      const n = sNodes[k];
      stamp[n] = stampId;
      g[n] = startDist[k];
      pred[n] = -1;
      heap.push(g[n] + h(n), n);
    }

    let best = direct;
    let bestNode = -1;
    while (heap.size > 0) {
      const key = heap.peekKey();
      if (key >= best) break;
      const u = heap.pop();
      const gu = g[u];
      if (key > gu + h(u) + 1e-3) continue; // stale entry
      const tg = toGoal.get(u);
      if (tg !== undefined && gu + tg < best) {
        best = gu + tg;
        bestNode = u;
      }
      // Crossing to the other side of the portal.
      const v = u ^ 1;
      const cross = grid.cost[this.nodeCell(cd, v)];
      this.relax(cd, stampId, u, v, gu + cross, h, heap);
      // Intra-sector links.
      const sec = (u & 1) === 0 ? cd.sectorA[u >> 1] : cd.sectorB[u >> 1];
      const nodes = cd.secNodes[sec];
      const n = nodes.length;
      const idx = nodes.indexOf(u);
      const row = idx * n;
      const costs = cd.secCost[sec];
      for (let j = 0; j < n; j++) {
        const w = costs[row + j];
        if (j !== idx && w !== Infinity) this.relax(cd, stampId, u, nodes[j], gu + w, h, heap);
      }
    }
    if (best === Infinity) return none('disconnected');

    // Reconstruct.
    const pathNodes: number[] = [];
    for (let n = bestNode; n !== -1; n = pred[n]) pathNodes.push(n);
    pathNodes.reverse();
    const sectors: number[] = [sS];
    const portals: NavPortal[] = [];
    const push = (s: number) => {
      if (sectors[sectors.length - 1] !== s) sectors.push(s);
    };
    for (let k = 0; k < pathNodes.length; k++) {
      const n = pathNodes[k];
      push((n & 1) === 0 ? cd.sectorA[n >> 1] : cd.sectorB[n >> 1]);
      if (k > 0 && pathNodes[k - 1] >> 1 === n >> 1) portals.push(this.portalOf(cd, n >> 1));
    }
    push(sG);
    return { found: true, cost: best, sectors, portals };
  }

  // --- portals ------------------------------------------------------------------------------

  private portalOf(cd: ClassData, id: number): NavPortal {
    const W = this.grid.width;
    const a = cd.cellA[id];
    const b = cd.cellB[id];
    return {
      id,
      sectorA: cd.sectorA[id],
      sectorB: cd.sectorB[id],
      cellA: a,
      cellB: b,
      ax: a % W,
      ay: Math.floor(a / W),
      bx: b % W,
      by: Math.floor(b / W),
    };
  }

  private nodeCell(cd: ClassData, node: number): number {
    return (node & 1) === 0 ? cd.cellA[node >> 1] : cd.cellB[node >> 1];
  }

  private passable(cd: ClassData, index: number): boolean {
    return (this.grid.flags[index] & NavFlag.BLOCKED) === 0 && this.grid.clearance[index] >= cd.threshold;
  }

  /**
   * Recomputes the portals on the east (or south) edge of `owner`. Returns true when the set of
   * portals changed (portal ids are kept when it did not).
   */
  private updateEdge(cd: ClassData, east: boolean, owner: number): boolean {
    const S = this.sectorSize;
    const { width: W, height: H } = this.grid;
    const sx = owner % this.sectorsX;
    const sy = (owner - sx) / this.sectorsX;
    const neighbour = east ? owner + 1 : owner + this.sectorsX;
    const list = east ? cd.east[owner] : cd.south[owner];
    if (east ? sx + 1 >= this.sectorsX : sy + 1 >= this.sectorsY) return false;
    // Runs along the edge: `step` is the cell offset along the edge, `across` crosses it.
    const across = east ? 1 : W;
    const fixed = east ? (sx + 1) * S - 1 : (sy + 1) * S - 1;
    const from = east ? sy * S : sx * S;
    const to = Math.min(east ? H : W, from + S);
    const base = (p: number) => (east ? p * W + fixed : fixed * W + p);
    const pairs: number[] = [];
    let runStart = -1;
    for (let p = from; p <= to; p++) {
      const open = p < to && this.passable(cd, base(p)) && this.passable(cd, base(p) + across);
      if (open && runStart < 0) runStart = p;
      if (!open && runStart >= 0) {
        const mid = (runStart + p - 1) >> 1;
        pairs.push(base(mid), base(mid) + across);
        runStart = -1;
      }
    }
    let same = list.length * 2 === pairs.length;
    for (let k = 0; same && k < list.length; k++) {
      same = cd.cellA[list[k]] === pairs[2 * k] && cd.cellB[list[k]] === pairs[2 * k + 1];
    }
    if (same) return false;
    for (const id of list) cd.free.push(id);
    list.length = 0;
    for (let k = 0; k < pairs.length; k += 2) {
      list.push(this.allocPortal(cd, pairs[k], pairs[k + 1], owner, neighbour));
    }
    return true;
  }

  private allocPortal(cd: ClassData, cellA: number, cellB: number, sectorA: number, sectorB: number): number {
    let id = cd.free.pop();
    if (id === undefined) {
      id = cd.poolSize++;
      if (id >= cd.cellA.length) {
        const grow = (a: Int32Array) => {
          const next = new Int32Array(a.length * 2);
          next.set(a);
          return next;
        };
        cd.cellA = grow(cd.cellA);
        cd.cellB = grow(cd.cellB);
        cd.sectorA = grow(cd.sectorA);
        cd.sectorB = grow(cd.sectorB);
      }
    }
    cd.cellA[id] = cellA;
    cd.cellB[id] = cellB;
    cd.sectorA[id] = sectorA;
    cd.sectorB[id] = sectorB;
    return id;
  }

  // --- intra-sector links ------------------------------------------------------------------

  private rebuildIntra(cd: ClassData, s: number): void {
    const sx = s % this.sectorsX;
    const sy = (s - sx) / this.sectorsX;
    const list: number[] = [];
    for (const id of cd.east[s]) list.push(id * 2);
    for (const id of cd.south[s]) list.push(id * 2);
    if (sx > 0) for (const id of cd.east[s - 1]) list.push(id * 2 + 1);
    if (sy > 0) for (const id of cd.south[s - this.sectorsX]) list.push(id * 2 + 1);
    const nodes = Int32Array.from(list);
    const n = nodes.length;
    const costs = new Float32Array(n * n).fill(Infinity);
    cd.secNodes[s] = nodes;
    cd.secCost[s] = costs;
    if (n === 0) return;
    const W = this.grid.width;
    const rect = this.sectorRect(s);
    const cells = Array.from(nodes, (node) => this.nodeCell(cd, node));
    const labels = this.labelCells(cd, rect, cells);
    for (let i = 0; i < n; i++) {
      costs[i * n + i] = 0;
      const targets: number[] = [];
      const targetIdx: number[] = [];
      for (let j = 0; j < n; j++) {
        if (j !== i && labels[j] === labels[i]) {
          targets.push(cells[j]);
          targetIdx.push(j);
        }
      }
      if (targets.length === 0) continue;
      this.localSearch(cd.threshold, s, cells[i], false, targets);
      for (let k = 0; k < targets.length; k++) {
        const c = targets[k];
        costs[i * n + targetIdx[k]] = this.lDist[(Math.floor(c / W) - rect.y) * rect.width + (c % W) - rect.x];
      }
    }
  }

  /** Labels the cells by connected region inside a sector (same move rules as the search). */
  private labelCells(cd: ClassData, rect: NavRect, cells: number[]): Int32Array {
    const W = this.grid.width;
    const { width: sw, height: sh } = rect;
    const label = this.lLabel;
    label.fill(0, 0, sw * sh);
    const queue = this.lQueue;
    const out = new Int32Array(cells.length);
    let next = 0;
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k];
      const local = (Math.floor(c / W) - rect.y) * sw + (c % W) - rect.x;
      if (label[local] === 0) {
        const id = ++next;
        let head = 0;
        let tail = 0;
        queue[tail++] = local;
        label[local] = id;
        while (head < tail) {
          const lu = queue[head++];
          const ux = rect.x + (lu % sw);
          const uy = rect.y + Math.floor(lu / sw);
          for (let d = 0; d < 8; d++) {
            const nx = ux + DX[d];
            const ny = uy + DY[d];
            if (nx < rect.x || ny < rect.y || nx >= rect.x + sw || ny >= rect.y + sh) continue;
            const ln = (ny - rect.y) * sw + (nx - rect.x);
            if (label[ln] !== 0 || !this.passable(cd, ny * W + nx)) continue;
            if (d >= 4 && (!this.passable(cd, uy * W + nx) || !this.passable(cd, ny * W + ux))) continue;
            label[ln] = id;
            queue[tail++] = ln;
          }
        }
      }
      out[k] = label[local];
    }
    return out;
  }

  /**
   * Dijkstra restricted to one sector from a source cell. With `reverse` the search computes the
   * cost of the path from every cell to the source (so the cost of leaving a cell is charged).
   * Stops when every target cell is settled. Distances are left in `lDist` (local indices).
   */
  private localSearch(
    threshold: number,
    sector: number,
    source: number,
    reverse: boolean,
    targets: number[],
  ): void {
    const { flags, clearance, cost, width: W } = this.grid;
    const rect = this.sectorRect(sector);
    const { x: x0, y: y0, width: sw, height: sh } = rect;
    const area = sw * sh;
    const dist = this.lDist;
    const done = this.lDone;
    const mark = this.lMark;
    dist.fill(Infinity, 0, area);
    done.fill(0, 0, area);
    mark.fill(0, 0, area);
    let remaining = 0;
    for (const c of targets) {
      const l = (Math.floor(c / W) - y0) * sw + (c % W) - x0;
      if (mark[l] === 0) {
        mark[l] = 1;
        remaining++;
      }
    }
    if (targets.length === 0) {
      dist[(Math.floor(source / W) - y0) * sw + (source % W) - x0] = 0;
      return;
    }
    const heap = this.heap;
    heap.clear();
    const src = (Math.floor(source / W) - y0) * sw + (source % W) - x0;
    dist[src] = 0;
    heap.push(0, src);
    const pass = (i: number) => (flags[i] & NavFlag.BLOCKED) === 0 && clearance[i] >= threshold;
    while (heap.size > 0) {
      const lu = heap.pop();
      if (done[lu] === 1) continue;
      done[lu] = 1;
      if (mark[lu] === 1 && --remaining === 0) break;
      const d = dist[lu];
      const ux = x0 + (lu % sw);
      const uy = y0 + ((lu / sw) | 0);
      const ui = uy * W + ux;
      for (let k = 0; k < 8; k++) {
        const nx = ux + DX[k];
        const ny = uy + DY[k];
        if (nx < x0 || ny < y0 || nx >= x0 + sw || ny >= y0 + sh) continue;
        const ni = ny * W + nx;
        if (!pass(ni)) continue;
        if (k >= 4 && (!pass(uy * W + nx) || !pass(ny * W + ux))) continue;
        const ln = (ny - y0) * sw + (nx - x0);
        if (done[ln] === 1) continue;
        const step = (reverse ? cost[ui] : cost[ni]) * (k >= 4 ? SQRT2 : 1);
        const nd = d + step;
        if (nd < dist[ln]) {
          dist[ln] = nd;
          heap.push(nd, ln);
        }
      }
    }
  }

  // --- components and abstract search ------------------------------------------------------

  private computeComponents(cd: ClassData): void {
    const total = cd.poolSize * 2;
    const parent = new Int32Array(total);
    for (let i = 0; i < total; i++) parent[i] = i;
    const find = (a: number): number => {
      while (parent[a] !== a) {
        parent[a] = parent[parent[a]];
        a = parent[a];
      }
      return a;
    };
    const union = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };
    for (let s = 0; s < this.sectorCount; s++) {
      for (const id of cd.east[s]) union(id * 2, id * 2 + 1);
      for (const id of cd.south[s]) union(id * 2, id * 2 + 1);
      const nodes = cd.secNodes[s];
      const n = nodes.length;
      const costs = cd.secCost[s];
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) if (costs[i * n + j] !== Infinity) union(nodes[i], nodes[j]);
      }
    }
    const comp = new Int32Array(total);
    for (let i = 0; i < total; i++) comp[i] = find(i);
    cd.comp = comp;
  }

  private ensureScratch(cd: ClassData): void {
    const total = cd.poolSize * 2;
    if (cd.g.length < total) {
      cd.g = new Float64Array(total);
      cd.pred = new Int32Array(total);
      cd.stamp = new Int32Array(total);
      cd.stampCounter = 0;
    }
  }

  private relax(
    cd: ClassData,
    stampId: number,
    from: number,
    to: number,
    g: number,
    h: (node: number) => number,
    heap: NavMinHeap,
  ): void {
    if (cd.stamp[to] === stampId && cd.g[to] <= g) return;
    cd.stamp[to] = stampId;
    cd.g[to] = g;
    cd.pred[to] = from;
    heap.push(g + h(to), to);
  }
}
