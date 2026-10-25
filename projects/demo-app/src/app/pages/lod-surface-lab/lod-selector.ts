import { domainPoint, neighbourCell, rootCount, type LodDomain, type NeighbourCell, type Vec3 } from './lod-domain';

/**
 * Plan 059 M1 selector: a 2:1-balanced quadtree per root, rebuilt every frame from the roots by priority splitting
 * under a leaf cap, then an edge mask per leaf (bit e set = the neighbour across edge e is one level coarser).
 *
 * Criteria (M1): distance (a cell should cover at most `cellPixels` pixels, never fewer than {@link PIXEL_FLOOR}) or a
 * fixed level everywhere (the uniform baseline). Priority = how many times too big a node's cells are; the most
 * over-sized node splits first, so when the cap stops splitting the coarse cover is still whole and the remaining
 * requests are counted as unmet. All storage is typed arrays sized once per settings change: no per-frame allocation.
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

export class LodSelector {
  readonly settings: SelectorSettings;
  readonly maxLevel: number;
  /** Node pool. */
  readonly root: Uint8Array;
  readonly level: Uint8Array;
  readonly i: Uint32Array;
  readonly j: Uint32Array;
  /** First of four children, or -1 for a leaf. */
  readonly child: Int32Array;
  readonly center: Float64Array;
  readonly normal: Float64Array;
  readonly radius: Float64Array;
  readonly edge: Float64Array;
  readonly priority: Float64Array;
  readonly visible: Uint8Array;
  nodeCount = 0;
  /** Leaves after {@link select}, as node indices, with their edge masks; drawn leaves first (`stats.drawn`). */
  readonly leaves: Int32Array;
  readonly masks: Uint8Array;
  readonly stats: SelectorStats = { leaves: 0, drawn: 0, splits: 0, forcedSplits: 0, unmet: 0, capHit: false, deepestLevel: 0 };
  private readonly heap: Int32Array;
  private heapSize = 0;
  private leafCount = 0;
  private view: SelectorView | undefined;
  private readonly cell: NeighbourCell = { root: 0, i: 0, j: 0 };
  private readonly point: Vec3 = [0, 0, 0];
  private readonly pointNormal: Vec3 = [0, 0, 0];
  private readonly corner: Vec3 = [0, 0, 0];

  constructor(settings: SelectorSettings) {
    this.settings = settings;
    this.maxLevel = maxLevelFor(settings.patchCells);
    const capacity = 2 * (settings.leafCap + CAP_SLACK) + 64;
    this.root = new Uint8Array(capacity);
    this.level = new Uint8Array(capacity);
    this.i = new Uint32Array(capacity);
    this.j = new Uint32Array(capacity);
    this.child = new Int32Array(capacity);
    this.center = new Float64Array(capacity * 3);
    this.normal = new Float64Array(capacity * 3);
    this.radius = new Float64Array(capacity);
    this.edge = new Float64Array(capacity);
    this.priority = new Float64Array(capacity);
    this.visible = new Uint8Array(capacity);
    this.heap = new Int32Array(capacity);
    this.leaves = new Int32Array(settings.leafCap + CAP_SLACK + 6);
    this.masks = new Uint8Array(settings.leafCap + CAP_SLACK + 6);
  }

  /** Rebuilds the tree for a view and fills {@link leaves}, {@link masks} and {@link stats}. */
  select(view: SelectorView): void {
    this.view = view;
    this.nodeCount = 0;
    this.heapSize = 0;
    const stats = this.stats;
    stats.splits = 0;
    stats.forcedSplits = 0;
    stats.capHit = false;
    const roots = rootCount(this.settings.domain);
    for (let r = 0; r < roots; r++) this.push(this.addNode(r, 0, 0, 0));
    this.leafCount = roots;

    while (this.heapSize > 0) {
      const node = this.pop();
      if (this.child[node] !== -1) continue;
      if (this.leafCount + 3 > this.settings.leafCap || !this.split(node, false)) {
        // Put it back so the unmet count below includes it.
        this.push(node);
        stats.capHit = true;
        break;
      }
    }
    stats.unmet = 0;
    for (let k = 0; k < this.heapSize; k++) if (this.child[this.heap[k]] === -1) stats.unmet++;
    this.collectLeaves();
  }

  /** Index of the deepest node at or above `level` covering cell (i, j) of `level` on `root`. */
  findCovering(root: number, level: number, i: number, j: number): number {
    let node = root;
    while (this.child[node] !== -1 && this.level[node] < level) {
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
      if (!neighbourCell(this.settings.domain, this.root[node], level, this.i[node], this.j[node], e, this.cell)) continue;
      const other = this.findCovering(this.cell.root, level, this.cell.i, this.cell.j);
      if (this.level[other] < level) mask |= 1 << e;
    }
    return mask;
  }

  private collectLeaves(): void {
    // Drawn leaves first, then the culled ones (kept for checks); one pass each over the leaf set.
    let count = 0;
    let deepest = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let node = 0; node < this.nodeCount; node++) {
        if (this.child[node] !== -1 || (this.visible[node] === 1) !== (pass === 0)) continue;
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
   * False when the node is at the deepest level or the pool is full.
   */
  private split(node: number, forced: boolean): boolean {
    const level = this.level[node];
    if (level >= this.maxLevel || this.nodeCount + 4 > this.child.length) return false;
    if (this.leafCount + 3 > this.settings.leafCap + CAP_SLACK) return false;
    for (let e = 0; e < 4; e++) {
      if (!neighbourCell(this.settings.domain, this.root[node], level, this.i[node], this.j[node], e, this.cell)) continue;
      const other = this.findCovering(this.cell.root, level, this.cell.i, this.cell.j);
      if (this.level[other] < level && this.child[other] === -1 && !this.split(other, true)) return false;
    }
    const first = this.nodeCount;
    const root = this.root[node];
    const i = this.i[node] * 2;
    const j = this.j[node] * 2;
    for (let k = 0; k < 4; k++) this.addNode(root, level + 1, i + (k & 1), j + (k >> 1));
    this.child[node] = first;
    this.leafCount += 3;
    if (forced) this.stats.forcedSplits++;
    else this.stats.splits++;
    for (let k = 0; k < 4; k++) this.push(first + k);
    return true;
  }

  private addNode(root: number, level: number, i: number, j: number): number {
    const node = this.nodeCount++;
    this.root[node] = root;
    this.level[node] = level;
    this.i[node] = i;
    this.j[node] = j;
    this.child[node] = -1;
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
    this.visible[node] = this.isVisible(node) ? 1 : 0;
    this.priority[node] = this.visible[node] ? this.splitPriority(node) : 0;
    return node;
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
    const distance = Math.hypot(this.center[c] - view.camera[0], this.center[c + 1] - view.camera[1], this.center[c + 2] - view.camera[2]);
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
