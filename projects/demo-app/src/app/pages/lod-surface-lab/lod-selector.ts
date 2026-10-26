import { EDGE_STEP, domainPoint, neighbourCell, rootCount, type LodDomain, type NeighbourCell, type Vec3 } from './lod-domain';
import type { NodeHeightRanges } from './lod-height';

/**
 * Plan 059 M1 selector: a 2:1-balanced quadtree per root, re-selected every frame from the roots by priority splitting
 * under a leaf cap, then an edge mask per leaf (bit e set = the neighbour across edge e is one level coarser).
 *
 * Criteria (M1): distance (a cell should cover at most `cellPixels` pixels, never fewer than {@link PIXEL_FLOOR}) or a
 * fixed level everywhere (the uniform baseline). Priority = how many times too big a node's cells are; the most
 * over-sized node splits first, so when the cap stops splitting the coarse cover is still whole and the remaining
 * requests are counted as unmet. All storage is typed arrays sized once per settings change: no per-frame allocation.
 *
 * Hysteresis (distance mode): the tree is rebuilt every frame, so a node whose cells sit right at the target size would
 * split and merge as the camera wobbles. With one threshold, `value = edge / target`, a leaf splits when value > 1; a node
 * that was split in the previous tree stays split while value > 1 / (1 + hysteresis), i.e. it merges only once its cells are
 * `hysteresis` smaller than the split point. A kept node is queued with its own value (at most 1), so it sorts after every
 * real request and the leaf cap serves requests before retentions; a retention the cap or the pool cannot afford is dropped
 * silently (it is not a request, so it is neither `capHit` nor `unmet`). Forced (2:1 balance) splits are not retained.
 *
 * The node pool persists across frames: a node keeps its block of four children, with their camera-independent
 * geometry, after it stops being split, so re-selecting a nearby view only redoes per-view culling and priority.
 * {@link LodSelector.open} marks the nodes split in the current frame; blocks the last tree did not reach are reclaimed
 * when the pool runs low.
 *
 * Neighbours are pointers, not searches: {@link LodSelector.nb} holds, per node and edge, the pool node of the same-level
 * cell across that edge (linked when the later of the two blocks is made, so it persists with the pool). In the current
 * tree that cell is a leaf or open exactly when its node is stamped with this frame; if it is not, a coarser leaf covers
 * it (edge mask bit set) and, by the 2:1 balance, that leaf is the parent's neighbour across the same edge. So the
 * balance check while splitting and the edge masks cost a few array reads per edge. A view identical to the last one
 * returns without redoing the tree ({@link LodSelector.version} says whether the leaves changed).
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
  /**
   * Per-node height ranges, when the source has them (a baked texture's min/max pyramid). A node's bounding sphere is then
   * centred at the middle of its range, along the node's normal, instead of widened by the global {@link heightBoundM}.
   */
  readonly heightRanges?: NodeHeightRanges;
  /** Refine and draw only nodes whose bounds touch the view frustum. */
  readonly cull: boolean;
  /**
   * Split/merge hysteresis ratio, distance mode only (absent or 0: a single threshold, as before). A node split in the last
   * tree stays split while its cells are less than `hysteresis` smaller than the split point (value > 1 / (1 + hysteresis)).
   */
  readonly hysteresis?: number;
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
  /** Nodes split by their own request this frame, including ones kept split by hysteresis (not the balance splits). */
  splits: number;
  forcedSplits: number;
  /** Nodes split in this tree that were not split in the last one (balance splits included); 0 when `select` returned early. */
  newSplits: number;
  /**
   * Nodes split in the last tree and not split in this one, including those below a node that merged; 0 when `select`
   * returned early. `newSplits + merges` is the level churn of the frame.
   */
  merges: number;
  /**
   * {@link newSplits} restricted to what is on screen: nodes split now and not in the last tree that were visible (inside
   * the frustum) in both trees. Nodes entering or leaving the frustum change level unseen, so they are not flicker.
   */
  visibleNewSplits: number;
  /**
   * {@link merges} restricted to what is on screen: leaves of this tree that were split in the last one and were visible in
   * both trees. A merged node counts once; the nodes below it are not in the tree.
   */
  visibleMerges: number;
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

/** Doubles per node in the packed geometry the per-view loop reads: centre x y z, bounding radius, longest edge per cell. */
const HOT = 8;
/** {@link LodSelector.select} remembers the last view as camera (3), frustum (12) and pixel angle. */
const VIEW_KEY = 16;

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
  /**
   * 1 when the node was split in the last tree that was built (the previous rebuilding {@link select}). Written for the
   * last tree's nodes when a rebuild starts, and checked against {@link stamp} when a node joins the new tree, so it is right
   * for every node of the current tree whatever happened between: a repeated view does not rebuild (nothing changes), and a
   * node that was not in the last tree (merged away, or freed by a reclaim and remade) reads 0.
   */
  readonly wasOpen: Uint8Array;
  /** {@link visible} as of the last tree, kept and validated exactly like {@link wasOpen}; 0 for a node not in the last tree. */
  readonly wasVisible: Uint8Array;
  /** Parent node, or -1 for a root. */
  readonly parent: Int32Array;
  readonly center: Float64Array;
  readonly normal: Float64Array;
  readonly radius: Float64Array;
  readonly edge: Float64Array;
  /**
   * How many times too big the node's cells are, for nodes queued to split this frame (above 1), or, for a node kept split
   * by hysteresis, its value in (1 / (1 + hysteresis), 1]; 0 for the rest.
   */
  readonly priority: Float64Array;
  readonly visible: Uint8Array;
  /** Same-level cell across each edge, 4 per node: root ({@link NO_NEIGHBOUR} at the plane's border), i, j. */
  readonly neighbourRoot: Uint8Array;
  readonly neighbourI: Uint32Array;
  readonly neighbourJ: Uint32Array;
  /**
   * Pool node of the same-level cell across each edge, 4 per node. Two stand-in nodes past the pool keep this branch-free:
   * {@link unlinked} when that cell has no node yet (never in the tree) and {@link none} at the plane's border (always).
   * Cleared to {@link unlinked} for nodes of freed blocks.
   */
  readonly nb: Int32Array;
  readonly unlinked: number;
  readonly none: number;
  /** Frame number in which the node was last part of the tree (a root, or a child of a node split that frame). */
  readonly stamp: Int32Array;
  /** Bumped by every {@link select} that rebuilt the tree; a repeat of the last view keeps it, and the leaves. */
  version = 0;
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
  readonly stats: SelectorStats = { leaves: 0, drawn: 0, splits: 0, forcedSplits: 0, newSplits: 0, merges: 0, visibleNewSplits: 0, visibleMerges: 0, unmet: 0, capHit: false, deepestLevel: 0 };
  /** Most nodes one tree can hold. */
  private readonly treeCapacity: number;
  private readonly heap: Int32Array;
  private readonly heapKey: Float64Array;
  private heapSize = 0;
  private frame = 0;
  /** Packed centre, radius and edge per cell, {@link HOT} doubles per node. */
  private readonly hot: Float64Array;
  private readonly capacity: number;
  private readonly culledLeaves: Int32Array;
  private readonly culledMasks: Uint8Array;
  private readonly viewKey = new Float64Array(VIEW_KEY);
  private hasViewKey = false;
  /** Pixels per target cell times the angle of a pixel: this view's metres of cell per metre of gap. */
  private pixelScale = 0;
  /** 1 / (1 + hysteresis): a node split in the last tree stays split above this value. 1 means no hysteresis. */
  private readonly keepValue: number;
  /** Nodes of the last tree that were split, counted while their flags are copied; the merges are those not split again. */
  private openLast = 0;
  private readonly freeBlocks: Int32Array;
  private freeCount = 0;
  private readonly live: Uint8Array;
  private leafCount = 0;
  private readonly cell: NeighbourCell = { root: 0, i: 0, j: 0 };
  private readonly point: Vec3 = [0, 0, 0];
  private readonly pointNormal: Vec3 = [0, 0, 0];
  private readonly corner: Vec3 = [0, 0, 0];
  private readonly range: [number, number] = [0, 0];

  /**
   * @param poolTrees Node pool size in trees, at least 2: after a reclaim the pool holds the last tree and must still
   * have room for a whole new one.
   */
  constructor(settings: SelectorSettings, poolTrees = POOL_TREES) {
    this.settings = settings;
    this.maxLevel = maxLevelFor(settings.patchCells);
    this.treeCapacity = 2 * (settings.leafCap + CAP_SLACK) + 64;
    const capacity = Math.max(2, poolTrees) * this.treeCapacity;
    this.capacity = capacity;
    this.keepValue = 1 / (1 + Math.max(0, settings.hysteresis ?? 0));
    this.unlinked = capacity;
    this.none = capacity + 1;
    this.root = new Uint8Array(capacity);
    this.level = new Uint8Array(capacity);
    this.i = new Uint32Array(capacity);
    this.j = new Uint32Array(capacity);
    this.child = new Int32Array(capacity + 2).fill(-1);
    this.open = new Uint8Array(capacity);
    this.wasOpen = new Uint8Array(capacity);
    this.wasVisible = new Uint8Array(capacity);
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
    this.nb = new Int32Array(capacity * 4);
    this.stamp = new Int32Array(capacity + 2);
    this.hot = new Float64Array(capacity * HOT);
    this.live = new Uint8Array(capacity);
    this.freeBlocks = new Int32Array(capacity >> 2);
    this.active = new Int32Array(this.treeCapacity);
    this.heap = new Int32Array(this.treeCapacity);
    this.heapKey = new Float64Array(this.treeCapacity);
    this.leaves = new Int32Array(settings.leafCap + CAP_SLACK + 6);
    this.masks = new Uint8Array(settings.leafCap + CAP_SLACK + 6);
    this.culledLeaves = new Int32Array(settings.leafCap + CAP_SLACK + 6);
    this.culledMasks = new Uint8Array(settings.leafCap + CAP_SLACK + 6);
  }

  /** Selects the tree for a view and fills {@link leaves}, {@link masks} and {@link stats}. */
  select(view: SelectorView): void {
    if (this.sameView(view)) {
      // Nothing was rebuilt, so nothing changed level this call.
      this.stats.newSplits = 0;
      this.stats.merges = 0;
      this.stats.visibleNewSplits = 0;
      this.stats.visibleMerges = 0;
      return;
    }
    this.version++;
    this.frame++;
    this.pixelScale = Math.max(this.settings.cellPixels, PIXEL_FLOOR) * view.pixelAngle;
    this.heapSize = 0;
    const stats = this.stats;
    stats.splits = 0;
    stats.forcedSplits = 0;
    stats.capHit = false;
    this.openLast = 0;
    const roots = rootCount(this.settings.domain);
    if (this.nodeCount === 0) {
      for (let r = 0; r < roots; r++) this.initNode(this.nodeCount++, -1, r, 0, 0, 0);
      // A root's neighbours are roots, which are always in the tree.
      for (let n = 0; n < roots * 4; n++) if (this.nb[n] !== this.none) this.nb[n] = this.neighbourRoot[n];
    } else {
      // Room for a whole new tree, or drop what the last tree did not reach (it needs last frame's open flags).
      if (this.capacity - this.nodeCount + 4 * this.freeCount < this.treeCapacity) this.reclaim(roots);
      // The last tree's flags become "split last frame" (the new tree is built against them), then the open flags restart.
      const { active, open, wasOpen, wasVisible, visible } = this;
      let openLast = 0;
      for (let k = 0; k < this.activeCount; k++) {
        const node = active[k];
        wasOpen[node] = open[node];
        wasVisible[node] = visible[node];
        openLast += open[node];
        open[node] = 0;
      }
      this.openLast = openLast;
    }
    this.activeCount = 0;
    this.stamp[this.none] = this.frame;
    this.activateRange(0, roots);
    this.leafCount = roots;

    while (this.heapSize > 0) {
      const node = this.pop();
      if (this.open[node] === 1) continue;
      if (this.leafCount + 3 > this.settings.leafCap || !this.split(node, false)) {
        // A request is put back so the unmet count below includes it. A retention (value at most 1: kept split only by
        // hysteresis) is dropped: nothing asked for it, and whatever is still queued sorts after it, so is a retention too.
        if (this.priority[node] > 1) {
          this.push(node, this.priority[node]);
          stats.capHit = true;
        }
        break;
      }
    }
    stats.unmet = 0;
    for (let k = 0; k < this.heapSize; k++) if (this.open[this.heap[k]] === 0 && this.priority[this.heap[k]] > 1) stats.unmet++;
    this.collectLeaves();
  }

  /** True when the view equals the last one selected for (then the tree is already right); otherwise remembers it. */
  private sameView(view: SelectorView): boolean {
    const key = this.viewKey;
    const camera = view.camera;
    const frustum = view.frustum;
    let same = this.hasViewKey && key[15] === view.pixelAngle;
    for (let k = 0; k < 3; k++) if (key[k] !== camera[k]) same = false;
    for (let k = 0; k < 12; k++) if (key[3 + k] !== frustum[k]) same = false;
    if (same) return true;
    for (let k = 0; k < 3; k++) key[k] = camera[k];
    for (let k = 0; k < 12; k++) key[3 + k] = frustum[k];
    key[15] = view.pixelAngle;
    this.hasViewKey = true;
    return false;
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
    // Drawn leaves first, then the culled ones (kept for checks), each in tree order.
    const { active, open, visible, level, leaves, masks, culledLeaves, culledMasks, nb, stamp, frame } = this;
    let drawn = 0;
    let culled = 0;
    let deepest = 0;
    // Split nodes of this tree that were (kept) or were not (opened) split in the last one.
    let kept = 0;
    let opened = 0;
    let visibleOpened = 0;
    let visibleMerged = 0;
    const wasOpen = this.wasOpen;
    const wasVisible = this.wasVisible;
    for (let k = 0; k < this.activeCount; k++) {
      const node = active[k];
      if (open[node] === 1) {
        if (wasOpen[node] === 1) kept++;
        else {
          opened++;
          if (visible[node] === 1 && wasVisible[node] === 1) visibleOpened++;
        }
        continue;
      }
      // Bit e: the same-level cell across edge e is not in the tree, so a coarser leaf covers it.
      const n = node * 4;
      const mask =
        (stamp[nb[n]] !== frame ? 1 : 0) | (stamp[nb[n + 1]] !== frame ? 2 : 0) | (stamp[nb[n + 2]] !== frame ? 4 : 0) | (stamp[nb[n + 3]] !== frame ? 8 : 0);
      if (visible[node] === 1) {
        if (wasOpen[node] === 1 && wasVisible[node] === 1) visibleMerged++;
        leaves[drawn] = node;
        masks[drawn++] = mask;
      } else {
        culledLeaves[culled] = node;
        culledMasks[culled++] = mask;
      }
      if (level[node] > deepest) deepest = level[node];
    }
    for (let k = 0; k < culled; k++) {
      leaves[drawn + k] = culledLeaves[k];
      masks[drawn + k] = culledMasks[k];
    }
    this.stats.drawn = drawn;
    this.stats.leaves = drawn + culled;
    this.stats.deepestLevel = deepest;
    this.stats.newSplits = opened;
    this.stats.merges = this.openLast - kept;
    this.stats.visibleNewSplits = visibleOpened;
    this.stats.visibleMerges = visibleMerged;
  }

  /**
   * Splits a leaf after making every edge neighbour at least as fine (2:1 balance), splitting coarser neighbours first.
   * False when the node is at the deepest level or the tree or pool is full.
   */
  private split(node: number, forced: boolean): boolean {
    const level = this.level[node];
    if (level >= this.maxLevel || this.activeCount + 4 > this.treeCapacity) return false;
    if (this.leafCount + 3 > this.settings.leafCap + CAP_SLACK) return false;
    if (this.child[node] === -1 && this.freeCount === 0 && this.nodeCount + 4 > this.capacity) return false;
    const nb = this.nb;
    for (let e = 0; e < 4; e++) {
      if (this.stamp[nb[node * 4 + e]] === this.frame) continue;
      const other = this.coarserNeighbour(node, e);
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
      this.linkBlock(node, first);
      this.child[node] = first;
    }
    this.open[node] = 1;
    this.leafCount += 3;
    if (forced) this.stats.forcedSplits++;
    else this.stats.splits++;
    this.activateRange(first, 4);
    return true;
  }

  /**
   * The leaf covering the same-level cell across edge `e` of `node` when that cell is not in the tree: by the balance it
   * is the parent's neighbour across the same edge. Falls back to a search from the tree if the pointer is not such a leaf.
   */
  private coarserNeighbour(node: number, e: number): number {
    const other = this.nb[this.parent[node] * 4 + e];
    if (this.stamp[other] === this.frame && this.open[other] === 0) return other;
    return this.coveringNeighbour(node, e);
  }

  /** Sets {@link nb} for the four new children of `parent`, and the matching pointer back from each linked neighbour. */
  private linkBlock(parent: number, first: number): void {
    const { nb, child, neighbourRoot, neighbourI, neighbourJ, root, i, j } = this;
    for (let k = 0; k < 4; k++) {
      const node = first + k;
      for (let e = 0; e < 4; e++) {
        const n = node * 4 + e;
        const ni = (k & 1) + EDGE_STEP[e][0];
        const nj = (k >> 1) + EDGE_STEP[e][1];
        if (ni >= 0 && ni < 2 && nj >= 0 && nj < 2) {
          nb[n] = first + ni + 2 * nj;
          continue;
        }
        // Across the parent's edge: the cell is a child of the parent's own neighbour, if that has a block yet.
        const across = nb[parent * 4 + e];
        if (child[across] === -1) {
          nb[n] = across === this.none ? across : this.unlinked;
          continue;
        }
        const other = child[across] + (neighbourI[n] & 1) + 2 * (neighbourJ[n] & 1);
        nb[n] = other;
        for (let f = 0; f < 4; f++) {
          const m = other * 4 + f;
          if (neighbourRoot[m] === root[node] && neighbourI[m] === i[node] && neighbourJ[m] === j[node]) {
            nb[m] = node;
            break;
          }
        }
      }
    }
  }

  /**
   * Adds `count` consecutive nodes to the current tree as leaves, with this view's culling and priority, and queues the
   * ones that ask for a split.
   */
  private activateRange(first: number, count: number): void {
    const { active, stamp, visible, priority, hot, level, wasOpen, wasVisible, viewKey: key } = this;
    const { cull, mode, fixedLevel } = this.settings;
    const frame = this.frame;
    const keepValue = this.keepValue;
    const maxLevel = this.maxLevel;
    const pixelScale = this.pixelScale;
    let n = this.activeCount;
    for (let node = first; node < first + count; node++) {
      active[n++] = node;
      // Split in the last tree: open there, and in that tree (stamped one rebuild ago; older flags are stale).
      const kept = wasOpen[node] === 1 && stamp[node] === frame - 1;
      wasOpen[node] = kept ? 1 : 0;
      if (stamp[node] !== frame - 1) wasVisible[node] = 0;
      stamp[node] = frame;
      const h = node * HOT;
      const x = hot[h] - key[0];
      const y = hot[h + 1] - key[1];
      const z = hot[h + 2] - key[2];
      const r = hot[h + 3];
      if (cull && (key[3] * x + key[4] * y + key[5] * z < -r || key[6] * x + key[7] * y + key[8] * z < -r || key[9] * x + key[10] * y + key[11] * z < -r || key[12] * x + key[13] * y + key[14] * z < -r)) {
        visible[node] = 0;
        priority[node] = 0;
        continue;
      }
      visible[node] = 1;
      let value = 0;
      if (mode === 'fixed') {
        const nodeLevel = level[node];
        if (nodeLevel < maxLevel && nodeLevel < fixedLevel) value = 1 + fixedLevel - nodeLevel;
      } else {
        // Cells per target size; the deepest level has edge 0, so it never asks. The division only runs when the cell is too big.
        const target = pixelScale * Math.max(Math.sqrt(x * x + y * y + z * z) - r, 1e-3);
        const edge = hot[h + 4];
        // A node split in the last tree keeps its split down to keepValue (1 without hysteresis: the single threshold).
        if (edge > (kept ? target * keepValue : target)) value = edge / target;
      }
      if (value > 1 || (kept && value > 0 && keepValue < 1)) {
        priority[node] = value;
        this.push(node, value);
      } else priority[node] = 0;
    }
    this.activeCount = n;
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
    // Pointers into freed blocks would name nodes that are about to be remade as other cells.
    const nb = this.nb;
    for (let n = 0; n < this.nodeCount * 4; n++) if (nb[n] < this.nodeCount && live[nb[n]] === 0) nb[n] = this.unlinked;
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
    this.wasOpen[node] = 0;
    this.wasVisible[node] = 0;
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
    const h = node * HOT;
    const ranges = this.settings.heightRanges;
    if (ranges) {
      // Displaced points lie between heights lo and hi along their own normals, which differ from the centre's by at most
      // (distance / radius) on a sphere: centre the sphere at the middle height and widen by half the range plus that tilt.
      ranges.nodeRange(root, level, i, j, this.range);
      const mid = (this.range[0] + this.range[1]) / 2;
      const tilt = domain.kind === 'sphere' ? Math.abs(mid) / domain.sizeM : 0;
      this.radius[node] = radius * (1 + tilt) + (this.range[1] - this.range[0]) / 2;
      for (let k = 0; k < 3; k++) this.hot[h + k] = point[k] + this.normal[c + k] * mid;
    } else {
      this.radius[node] = radius + this.settings.heightBoundM;
      this.hot[h] = point[0];
      this.hot[h + 1] = point[1];
      this.hot[h + 2] = point[2];
    }
    this.edge[node] = edge;
    this.hot[h + 3] = this.radius[node];
    this.hot[h + 4] = level >= this.maxLevel ? 0 : edge / this.settings.patchCells;
    const cell = this.cell;
    for (let e = 0; e < 4; e++) {
      const n = node * 4 + e;
      const found = neighbourCell(domain, root, level, i, j, e, cell);
      this.neighbourRoot[n] = found ? cell.root : NO_NEIGHBOUR;
      this.neighbourI[n] = cell.i;
      this.neighbourJ[n] = cell.j;
      this.nb[n] = found ? this.unlinked : this.none;
    }
  }

  private push(node: number, value: number): void {
    const heap = this.heap;
    const keys = this.heapKey;
    let k = this.heapSize++;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (keys[parent] >= value) break;
      heap[k] = heap[parent];
      keys[k] = keys[parent];
      k = parent;
    }
    heap[k] = node;
    keys[k] = value;
  }

  private pop(): number {
    const heap = this.heap;
    const keys = this.heapKey;
    const top = heap[0];
    const size = --this.heapSize;
    const node = heap[size];
    const value = keys[size];
    let k = 0;
    while (true) {
      const left = 2 * k + 1;
      if (left >= size) break;
      const right = left + 1;
      const best = right < size && keys[right] > keys[left] ? right : left;
      if (keys[best] <= value) break;
      heap[k] = heap[best];
      keys[k] = keys[best];
      k = best;
    }
    heap[k] = node;
    keys[k] = value;
    return top;
  }
}
