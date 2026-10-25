import { domainPoint, neighbourCell, rootCount, type LodDomain, type NeighbourCell, type Vec3 } from './lod-domain';

/**
 * Plan 059 M1 selector: a 2:1-balanced quadtree per root, re-selected every frame from the roots by priority splitting
 * under a leaf cap, then an edge mask per leaf (bit e set = the neighbour across edge e is one level coarser).
 *
 * Criteria (M1): distance (a cell should cover at most `cellPixels` pixels, never fewer than {@link PIXEL_FLOOR}) or a
 * fixed level everywhere (the uniform baseline). Priority = how many times too big a node's cells are; the most
 * over-sized node splits first, so when the cap stops splitting the coarse cover is still whole and the remaining
 * requests are counted as unmet. All storage is typed arrays sized once per settings change: no per-frame allocation.
 *
 * The node pool persists across frames: a node keeps its block of four children, with their camera-independent
 * geometry, after it stops being split, so re-selecting a nearby view only redoes per-view culling and priority.
 * {@link LodSelector.open} marks the nodes split in the current frame; blocks the last tree did not reach are reclaimed
 * when the pool runs low.
 */

export type PatchCells = 16 | 32 | 64;
export const PATCH_CELLS: readonly PatchCells[] = [16, 32, 64];
export type LodMode = 'distance' | 'fixed';

/** No ordinary request may ask for cells smaller than this many pixels (review round 2). */
export const PIXEL_FLOOR = 2;

/**
 * Parameters stay exact in float32 on the GPU while (i * cells + vertex) < 2^24 (`lod-surface-mesh.ts`), so the
 * deepest level is 24 - log2(cells); 20 caps it for the plane and both spheres in M1 anyway.
 */
export function maxLevelFor(patchCells: PatchCells): number {
  return Math.min(20, 24 - Math.log2(patchCells));
}

export interface SelectorSettings {
  readonly domain: LodDomain;
  readonly patchCells: PatchCells;
  readonly mode: LodMode;
  readonly fixedLevel: number;
  /** Target cell size on screen, pixels; clamped to at least {@link PIXEL_FLOOR}. */
  readonly cellPixels: number;
  readonly leafCap: number;
  /** Largest |height| of the source anywhere, metres: widens every node's bounds. */
  readonly heightBoundM: number;
  /** Refine and draw only nodes whose bounds touch the view frustum. */
  readonly cull: boolean;
}

export interface SelectorView {
  /** Camera position in the domain frame, doubles. */
  readonly camera: Vec3;
  /** Radians per pixel at the screen centre. */
  readonly pixelAngle: number;
  /** Inward normals of the four side planes of the frustum, which pass through the camera: x, y, z per plane. */
  readonly frustum: Float64Array;
}

export interface SelectorStats {
  leaves: number;
  drawn: number;
  splits: number;
  forcedSplits: number;
  /** Nodes that still wanted to split when the cap or the node pool stopped splitting. */
  unmet: number;
  capHit: boolean;
  deepestLevel: number;
}

/** Extra leaves a balancing chain may add beyond the cap (each forced split adds three); sized for the deepest chain. */
export const CAP_SLACK = 3 * 2 * 24;

/** Default pool size in trees: the current tree plus retained blocks from earlier views. */
const POOL_TREES = 4;

/** {@link LodSelector.neighbourRoot} value for an edge on the plane's border. */
export const NO_NEIGHBOUR = 255;

export class LodSelector {
  readonly settings: SelectorSettings;
  readonly maxLevel: number;
  /** Node pool. */
  readonly root: Uint8Array;
  readonly level: Uint8Array;
  readonly i: Uint32Array;
  readonly j: Uint32Array;
  /** First of four retained children, or -1; they are in the current tree only while {@link open} is 1. */
  readonly child: Int32Array;
  /** 1 when the node is split in the current frame. */
  readonly open: Uint8Array;
  /** Parent node, or -1 for a root. */
  readonly parent: Int32Array;
  readonly center: Float64Array;
  readonly normal: Float64Array;
  readonly radius: Float64Array;
  readonly edge: Float64Array;
  readonly priority: Float64Array;
  readonly visible: Uint8Array;
  /** Same-level cell across each edge, 4 per node: root ({@link NO_NEIGHBOUR} at the plane's border), i, j. */
  readonly neighbourRoot: Uint8Array;
  readonly neighbourI: Uint32Array;
  readonly neighbourJ: Uint32Array;
  /** Pool high-water mark: every node below it is allocated or in a free block. */
  nodeCount = 0;
  /** Nodes of the current tree (roots, then the children of open nodes) in visiting order. */
  readonly active: Int32Array;
  activeCount = 0;
  /** Times the pool dropped unreached blocks (diagnostic). */
  reclaims = 0;
  /** Leaves after {@link select}, as node indices, with their edge masks; drawn leaves first (`stats.drawn`). */
  readonly leaves: Int32Array;
  readonly masks: Uint8Array;
  readonly stats: SelectorStats = { leaves: 0, drawn: 0, splits: 0, forcedSplits: 0, unmet: 0, capHit: false, deepestLevel: 0 };
  /** Most nodes one tree can hold. */
  private readonly treeCapacity: number;
  private readonly heap: Int32Array;
  private heapSize = 0;
  private readonly freeBlocks: Int32Array;
  private freeCount = 0;
  private readonly live: Uint8Array;
  private leafCount = 0;
  private view: SelectorView | undefined;
  private readonly cell: NeighbourCell = { root: 0, i: 0, j: 0 };
  private readonly point: Vec3 = [0, 0, 0];
  private readonly pointNormal: Vec3 = [0, 0, 0];
  private readonly corner: Vec3 = [0, 0, 0];

  /**
   * @param poolTrees Node pool size in trees, at least 2: after a reclaim the pool holds the last tree and must still
   * have room for a whole new one.
   */
  constructor(settings: SelectorSettings, poolTrees = POOL_TREES) {
    this.settings = settings;
    this.maxLevel = maxLevelFor(settings.patchCells);
    this.treeCapacity = 2 * (settings.leafCap + CAP_SLACK) + 64;
    const capacity = Math.max(2, poolTrees) * this.treeCapacity;
    this.root = new Uint8Array(capacity);
    this.level = new Uint8Array(capacity);
    this.i = new Uint32Array(capacity);
    this.j = new Uint32Array(capacity);
    this.child = new Int32Array(capacity);
    this.open = new Uint8Array(capacity);
    this.parent = new Int32Array(capacity);
    this.center = new Float64Array(capacity * 3);
    this.normal = new Float64Array(capacity * 3);
    this.radius = new Float64Array(capacity);
    this.edge = new Float64Array(capacity);
    this.priority = new Float64Array(capacity);
    this.visible = new Uint8Array(capacity);
    this.neighbourRoot = new Uint8Array(capacity * 4);
    this.neighbourI = new Uint32Array(capacity * 4);
    this.neighbourJ = new Uint32Array(capacity * 4);
    this.live = new Uint8Array(capacity);
    this.freeBlocks = new Int32Array(capacity >> 2);
    this.active = new Int32Array(this.treeCapacity);
    this.heap = new Int32Array(this.treeCapacity);
    this.leaves = new Int32Array(settings.leafCap + CAP_SLACK + 6);
    this.masks = new Uint8Array(settings.leafCap + CAP_SLACK + 6);
  }

  /** Selects the tree for a view and fills {@link leaves}, {@link masks} and {@link stats}. */
  select(view: SelectorView): void {
    this.view = view;
    this.heapSize = 0;
    const stats = this.stats;
    stats.splits = 0;
    stats.forcedSplits = 0;
    stats.capHit = false;
    const roots = rootCount(this.settings.domain);
    if (this.nodeCount === 0) {
      for (let r = 0; r < roots; r++) this.initNode(this.nodeCount++, -1, r, 0, 0, 0);
    } else {
      // Room for a whole new tree, or drop what the last tree did not reach (it needs last frame's open flags).
      if (this.child.length - this.nodeCount + 4 * this.freeCount < this.treeCapacity) this.reclaim(roots);
      for (let k = 0; k < this.activeCount; k++) this.open[this.active[k]] = 0;
    }
    this.activeCount = 0;
    for (let r = 0; r < roots; r++) this.activate(r);
    this.leafCount = roots;

    while (this.heapSize > 0) {
      const node = this.pop();
      if (this.open[node] === 1) continue;
      if (this.leafCount + 3 > this.settings.leafCap || !this.split(node, false)) {
        // Put it back so the unmet count below includes it.
        this.push(node);
        stats.capHit = true;
        break;
      }
    }
    stats.unmet = 0;
    for (let k = 0; k < this.heapSize; k++) if (this.open[this.heap[k]] === 0) stats.unmet++;
    this.collectLeaves();
  }

  /** Index of the deepest node at or above `level` covering cell (i, j) of `level` on `root`. */
  findCovering(root: number, level: number, i: number, j: number): number {
    return this.descend(root, level, i, j);
  }

  /** Index of the deepest node at or above `level` covering the cell across edge `edge` of `node` in the current tree. */
  coveringNeighbour(node: number, edge: number): number {
    const n = node * 4 + edge;
    const root = this.neighbourRoot[n];
    const level = this.level[node];
    const i = this.neighbourI[n];
    const j = this.neighbourJ[n];
    if (root !== this.root[node]) return this.descend(root, level, i, j);
    // Same root: climb to the nearest ancestor that also contains the neighbour cell, then descend from there.
    let start = node;
    while (this.level[start] > 0) {
      start = this.parent[start];
      const shift = level - this.level[start];
      if (i >>> shift === this.i[start] && j >>> shift === this.j[start]) break;
    }
    return this.descend(start, level, i, j);
  }

  /** Walks down the current tree from `node` toward cell (i, j) of `level`. */
  private descend(node: number, level: number, i: number, j: number): number {
    while (this.open[node] === 1 && this.level[node] < level) {
      const shift = level - this.level[node] - 1;
      node = this.child[node] + ((i >>> shift) & 1) + 2 * ((j >>> shift) & 1);
    }
    return node;
  }

  /** Edge mask of a node from the current tree (bit e: the leaf across edge e is coarser). */
  edgeMask(node: number): number {
    const level = this.level[node];
    let mask = 0;
    for (let e = 0; e < 4; e++) {
      if (this.neighbourRoot[node * 4 + e] === NO_NEIGHBOUR) continue;
      const other = this.coveringNeighbour(node, e);
      if (this.level[other] < level) mask |= 1 << e;
    }
    return mask;
  }

  private collectLeaves(): void {
    // Drawn leaves first, then the culled ones (kept for checks); one pass each over the current tree.
    let count = 0;
    let deepest = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < this.activeCount; k++) {
        const node = this.active[k];
        if (this.open[node] === 1 || (this.visible[node] === 1) !== (pass === 0)) continue;
        this.leaves[count] = node;
        this.masks[count] = this.edgeMask(node);
        if (this.level[node] > deepest) deepest = this.level[node];
        count++;
      }
      if (pass === 0) this.stats.drawn = count;
    }
    this.stats.leaves = count;
    this.stats.deepestLevel = deepest;
  }

  /**
   * Splits a leaf after making every edge neighbour at least as fine (2:1 balance), splitting coarser neighbours first.
   * False when the node is at the deepest level or the tree or pool is full.
   */
  private split(node: number, forced: boolean): boolean {
    const level = this.level[node];
    if (level >= this.maxLevel || this.activeCount + 4 > this.treeCapacity) return false;
    if (this.leafCount + 3 > this.settings.leafCap + CAP_SLACK) return false;
    if (this.child[node] === -1 && this.freeCount === 0 && this.nodeCount + 4 > this.child.length) return false;
    for (let e = 0; e < 4; e++) {
      if (this.neighbourRoot[node * 4 + e] === NO_NEIGHBOUR) continue;
      const other = this.coveringNeighbour(node, e);
      if (this.level[other] < level && this.open[other] === 0 && !this.split(other, true)) return false;
    }
    let first = this.child[node];
    if (first === -1) {
      if (this.freeCount > 0) first = this.freeBlocks[--this.freeCount];
      else {
        first = this.nodeCount;
        this.nodeCount += 4;
      }
      const root = this.root[node];
      const i = this.i[node] * 2;
      const j = this.j[node] * 2;
      for (let k = 0; k < 4; k++) this.initNode(first + k, node, root, level + 1, i + (k & 1), j + (k >> 1));
      this.child[node] = first;
    }
    this.open[node] = 1;
    this.leafCount += 3;
    if (forced) this.stats.forcedSplits++;
    else this.stats.splits++;
    for (let k = 0; k < 4; k++) this.activate(first + k);
    return true;
  }

  /** Adds a node to the current tree as a leaf, with this view's culling and priority, and queues it. */
  private activate(node: number): void {
    this.active[this.activeCount++] = node;
    this.visible[node] = this.isVisible(node) ? 1 : 0;
    this.priority[node] = this.visible[node] ? this.splitPriority(node) : 0;
    this.push(node);
  }

  /** Frees every child block the last tree did not reach; the pool then holds that tree and free blocks only. */
  private reclaim(roots: number): void {
    this.reclaims++;
    const live = this.live;
    live.fill(0, 0, this.nodeCount);
    for (let k = 0; k < this.activeCount; k++) live[this.active[k]] = 1;
    this.freeCount = 0;
    // Child blocks start at `roots` and are allocated four at a time, so they stay aligned.
    for (let first = roots; first < this.nodeCount; first += 4) if (live[first] === 0) this.freeBlocks[this.freeCount++] = first;
    for (let node = 0; node < this.nodeCount; node++) if (live[node] === 0 || this.open[node] === 0) this.child[node] = -1;
  }

  /** Sets a node's cell and its camera-independent data: centre, normal, bounding radius, longest edge, neighbours. */
  private initNode(node: number, parent: number, root: number, level: number, i: number, j: number): void {
    this.parent[node] = parent;
    this.root[node] = root;
    this.level[node] = level;
    this.i[node] = i;
    this.j[node] = j;
    this.child[node] = -1;
    this.open[node] = 0;
    const domain = this.settings.domain;
    const size = 1 / 2 ** level;
    const { point, pointNormal, corner } = this;
    domainPoint(domain, root, (i + 0.5) * size, (j + 0.5) * size, point, pointNormal);
    const c = node * 3;
    for (let k = 0; k < 3; k++) {
      this.center[c + k] = point[k];
      this.normal[c + k] = pointNormal[k];
    }
    let radius = 0;
    let previousX = 0;
    let previousY = 0;
    let previousZ = 0;
    let edge = 0;
    for (let k = 0; k < 5; k++) {
      const corner01 = k & 3;
      domainPoint(domain, root, (i + (corner01 === 1 || corner01 === 2 ? 1 : 0)) * size, (j + (corner01 >= 2 ? 1 : 0)) * size, corner, pointNormal);
      if (k < 4) radius = Math.max(radius, Math.hypot(corner[0] - point[0], corner[1] - point[1], corner[2] - point[2]));
      if (k > 0) edge = Math.max(edge, Math.hypot(corner[0] - previousX, corner[1] - previousY, corner[2] - previousZ));
      previousX = corner[0];
      previousY = corner[1];
      previousZ = corner[2];
    }
    this.radius[node] = radius + this.settings.heightBoundM;
    this.edge[node] = edge;
    const cell = this.cell;
    for (let e = 0; e < 4; e++) {
      const n = node * 4 + e;
      const found = neighbourCell(domain, root, level, i, j, e, cell);
      this.neighbourRoot[n] = found ? cell.root : NO_NEIGHBOUR;
      this.neighbourI[n] = cell.i;
      this.neighbourJ[n] = cell.j;
    }
  }

  private isVisible(node: number): boolean {
    const view = this.view;
    if (!this.settings.cull || !view) return true;
    const c = node * 3;
    const x = this.center[c] - view.camera[0];
    const y = this.center[c + 1] - view.camera[1];
    const z = this.center[c + 2] - view.camera[2];
    const r = this.radius[node];
    const f = view.frustum;
    for (let p = 0; p < 12; p += 3) if (f[p] * x + f[p + 1] * y + f[p + 2] * z < -r) return false;
    return true;
  }

  /** How many times too big this node's cells are for the criterion; above 1 asks for a split. */
  private splitPriority(node: number): number {
    const settings = this.settings;
    if (this.level[node] >= this.maxLevel) return 0;
    if (settings.mode === 'fixed') return this.level[node] < settings.fixedLevel ? 1 + settings.fixedLevel - this.level[node] : 0;
    const view = this.view;
    if (!view) return 0;
    const c = node * 3;
    const x = this.center[c] - view.camera[0];
    const y = this.center[c + 1] - view.camera[1];
    const z = this.center[c + 2] - view.camera[2];
    const distance = Math.sqrt(x * x + y * y + z * z);
    const gap = Math.max(distance - this.radius[node], 1e-3);
    const target = Math.max(settings.cellPixels, PIXEL_FLOOR) * view.pixelAngle * gap;
    return this.edge[node] / settings.patchCells / target;
  }

  private push(node: number): void {
    if (this.priority[node] <= 1) return;
    const heap = this.heap;
    const priority = this.priority;
    let k = this.heapSize++;
    heap[k] = node;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (priority[heap[parent]] >= priority[heap[k]]) break;
      const swap = heap[parent];
      heap[parent] = heap[k];
      heap[k] = swap;
      k = parent;
    }
  }

  private pop(): number {
    const heap = this.heap;
    const priority = this.priority;
    const top = heap[0];
    heap[0] = heap[--this.heapSize];
    let k = 0;
    while (true) {
      const left = 2 * k + 1;
      const right = left + 1;
      let best = k;
      if (left < this.heapSize && priority[heap[left]] > priority[heap[best]]) best = left;
      if (right < this.heapSize && priority[heap[right]] > priority[heap[best]]) best = right;
      if (best === k) break;
      const swap = heap[best];
      heap[best] = heap[k];
      heap[k] = swap;
      k = best;
    }
    return top;
  }
}
