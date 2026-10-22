import {
  LEAF_CELLS, MAX_LEVEL, beyondEdge, children, leafAngularRadius, leafAt, leafCentre, leafId,
  type Edge, type LeafKey, type Vec3,
} from './cube-sphere';

/**
 * Plan 055 contender B: which leaves to draw, on the CPU. A leaf splits while its cells would cover more than
 * `cellPixels` pixels at its nearest possible distance; leaves wholly behind the horizon or outside the view are kept
 * as culled leaves (they still bound their neighbours). Then the tree is balanced so edge neighbours differ by one
 * level at most, and each drawn leaf records which edges meet a coarser neighbour (`coarserEdges`, bit per `Edge`):
 * there its odd edge vertices fold onto the even ones, so both sides share the coarse edge exactly.
 */

export interface SelectView {
  readonly radiusM: number;
  /** Camera in the body frame (metres). */
  readonly camera: Readonly<Vec3>;
  /** Unit forward and up of the camera in the body frame, for the view test; leave out to keep every leaf in front. */
  readonly forward?: Readonly<Vec3>;
  readonly up?: Readonly<Vec3>;
  readonly fovDeg?: number;
  readonly aspect?: number;
  /** Radians per screen pixel. */
  readonly pixelAngle: number;
  /** Target size of a cell on screen, in pixels. */
  readonly cellPixels: number;
  /** Altitudes (metres) the ground lies between. */
  readonly band: Band;
  /**
   * Tighter altitudes for a leaf where known (from scans of it or an ancestor); the band otherwise. Without them a leaf
   * under a camera inside the band could hold ground at the camera, and would split to the deepest level.
   */
  readonly boundsOf?: (key: LeafKey, id: string) => Band | undefined;
  /** Deepest level allowed; default `MAX_LEVEL`. */
  readonly maxLevel?: number;
  /**
   * A rectangle of leaves held at one level (contender B's near volume zone): leaves over it split down to that level
   * whatever their distance or view, and none inside it splits further, also for balance.
   */
  readonly pinned?: PinnedRect;
}

export interface PinnedRect {
  readonly face: number;
  readonly level: number;
  /** Inclusive leaf ranges at `level`. */
  readonly i0: number;
  readonly i1: number;
  readonly j0: number;
  readonly j1: number;
}

export interface SelectedLeaf {
  readonly key: LeafKey;
  readonly id: string;
  /** Behind the horizon or outside the view: not drawn. */
  readonly culled: boolean;
  /** Bit `1 << edge` set where the neighbour across that edge is one level coarser. */
  coarserEdges: number;
}

export interface Selection {
  /** Every leaf of the tree, drawn or culled, by id. */
  readonly leaves: ReadonlyMap<string, SelectedLeaf>;
  /** The drawn leaves, coarse levels first. */
  readonly drawn: readonly SelectedLeaf[];
  /** Splits the balance pass added. */
  readonly balanceSplits: number;
  /** Splits the balance pass wanted of a pinned leaf and could not make: a crack at that edge. */
  readonly pinnedConflicts: number;
  /** The leaf of the tree that holds a direction. */
  holding(direction: Readonly<Vec3>): SelectedLeaf | undefined;
}

/** Angular size of a leaf edge at `level` (radians, the equal-angle face spans a quarter turn). */
export function leafAngle(level: number): number {
  return Math.PI / 2 / 2 ** level;
}

export interface Band {
  readonly bottomM: number;
  readonly topM: number;
}

interface Geometry {
  readonly centre: Vec3;
  readonly angularRadius: number;
  readonly band: Band;
}

/** Planes (unit normals pointing in, through the camera) of the view's four sides, or none. */
function viewPlanes(view: SelectView): Vec3[] {
  if (!view.forward || !view.up || !view.fovDeg || !view.aspect) return [];
  const f = view.forward;
  const u = view.up;
  const r: Vec3 = [f[1] * u[2] - f[2] * u[1], f[2] * u[0] - f[0] * u[2], f[0] * u[1] - f[1] * u[0]];
  const tanY = Math.tan((view.fovDeg * Math.PI) / 360);
  const tanX = tanY * view.aspect;
  // A direction f + a * axis is inside while a <= tan, that is while it has a non-negative dot with f * tan - axis.
  const plane = (axis: Readonly<Vec3>, tan: number, side: number): Vec3 => {
    const n: Vec3 = [f[0] * tan - axis[0] * side, f[1] * tan - axis[1] * side, f[2] * tan - axis[2] * side];
    const length = Math.hypot(n[0], n[1], n[2]);
    return [n[0] / length, n[1] / length, n[2] / length];
  };
  return [plane(r, tanX, 1), plane(r, tanX, -1), plane(u, tanY, 1), plane(u, tanY, -1)];
}

export function selectLeaves(view: SelectView): Selection {
  const R = view.radiusM;
  const { bottomM } = view.band;
  const maxLevel = Math.min(view.maxLevel ?? MAX_LEVEL, MAX_LEVEL);
  const camera = view.camera;
  const cameraDistance = Math.hypot(camera[0], camera[1], camera[2]);
  const cameraDirection: Vec3 = [camera[0] / cameraDistance, camera[1] / cameraDistance, camera[2] / cameraDistance];
  const cameraAltitude = cameraDistance - R;
  const planes = viewPlanes(view);
  // The horizon: nothing below the lowest ground occludes, so the occluder is the sphere at R + bottom.
  const occluder = R + bottomM;
  const horizon = cameraDistance > occluder ? Math.sqrt(cameraDistance ** 2 - occluder ** 2) : 0;

  const geometry = new Map<string, Geometry>();
  const geometryFor = (key: LeafKey, id: string): Geometry => {
    let found = geometry.get(id);
    if (!found) {
      const band = view.boundsOf?.(key, id) ?? view.band;
      geometry.set(id, (found = { centre: leafCentre(key), angularRadius: leafAngularRadius(key), band }));
    }
    return found;
  };

  const distanceTo = (g: Geometry): number => {
    const dot = Math.min(1, g.centre[0] * cameraDirection[0] + g.centre[1] * cameraDirection[1] + g.centre[2] * cameraDirection[2]);
    const gap = Math.max(0, Math.acos(dot) - g.angularRadius);
    const vertical = Math.max(0, cameraAltitude - g.band.topM, g.band.bottomM - cameraAltitude);
    return Math.hypot(R * gap, vertical);
  };

  const culled = (g: Geometry): boolean => {
    const { bottomM: bottom, topM: top } = g.band;
    const middle = R + (bottom + top) / 2;
    const centre: Vec3 = [g.centre[0] * middle, g.centre[1] * middle, g.centre[2] * middle];
    const radius = (R + top) * Math.sin(Math.min(g.angularRadius, Math.PI / 2)) + (top - bottom) / 2;
    const offset: Vec3 = [centre[0] - camera[0], centre[1] - camera[1], centre[2] - camera[2]];
    for (const n of planes) if (offset[0] * n[0] + offset[1] * n[1] + offset[2] * n[2] < -radius) return true;
    if (horizon > 0) {
      const outer = Math.hypot(...centre) + radius;
      const reach = horizon + (outer > occluder ? Math.sqrt(outer ** 2 - occluder ** 2) : 0);
      if (Math.hypot(...offset) - radius > reach) return true;
    }
    return false;
  };

  const wantsSplit = (key: LeafKey, g: Geometry): boolean => {
    if (key.level >= maxLevel) return false;
    const cellM = (R * leafAngle(key.level)) / LEAF_CELLS;
    const distance = Math.max(distanceTo(g), cellM * 0.5);
    return cellM / distance > view.pixelAngle * view.cellPixels;
  };

  const pin = view.pinned;
  /** Whether a leaf lies over the pinned rectangle: `inside` at its level, `over` above it (coarser), else `none`. */
  const pinState = (key: LeafKey): 'inside' | 'over' | 'none' => {
    if (!pin || key.face !== pin.face || key.level > pin.level) return 'none';
    const scale = 2 ** (pin.level - key.level);
    const overlaps = key.i * scale <= pin.i1 && (key.i + 1) * scale - 1 >= pin.i0 && key.j * scale <= pin.j1 && (key.j + 1) * scale - 1 >= pin.j0;
    if (!overlaps) return 'none';
    return key.level === pin.level ? 'inside' : 'over';
  };

  const leaves = new Map<string, SelectedLeaf>();
  const add = (key: LeafKey): void => {
    const id = leafId(key);
    const g = geometryFor(key, id);
    const out = culled(g);
    const pinned = pinState(key);
    if (pinned === 'over') {
      for (const child of children(key)) add(child);
      return;
    }
    if (pinned === 'none' && !out && wantsSplit(key, g)) {
      for (const child of children(key)) add(child);
      return;
    }
    leaves.set(id, { key, id, culled: out, coarserEdges: 0 });
  };
  for (let face = 0; face < 6; face++) add({ face, level: 0, i: 0, j: 0 });

  /** The leaf of the tree that holds a direction. */
  const holding = (direction: Readonly<Vec3>): SelectedLeaf | undefined => {
    for (let level = 0; level <= maxLevel; level++) {
      const found = leaves.get(leafId(leafAt(direction, level)));
      if (found) return found;
    }
    return undefined;
  };

  // Balance: split any leaf more than one level coarser than an edge neighbour, until none is.
  let balanceSplits = 0;
  let pinnedConflicts = 0;
  const split = (leaf: SelectedLeaf): void => {
    leaves.delete(leaf.id);
    for (const child of children(leaf.key)) {
      const id = leafId(child);
      leaves.set(id, { key: child, id, culled: culled(geometryFor(child, id)), coarserEdges: 0 });
    }
    balanceSplits++;
  };
  let queue = [...leaves.values()];
  while (queue.length) {
    const next: SelectedLeaf[] = [];
    for (const leaf of queue) {
      if (!leaves.has(leaf.id)) continue;
      for (const edge of [0, 1, 2, 3] as Edge[]) {
        for (const point of beyondEdge(leaf.key, edge, 2)) {
          const neighbour = holding(point);
          if (neighbour && neighbour.key.level < leaf.key.level - 1) {
            if (pinState(neighbour.key) === 'inside') {
              pinnedConflicts++;
              continue;
            }
            split(neighbour);
            for (const child of children(neighbour.key)) next.push(leaves.get(leafId(child))!);
            next.push(leaf);
          }
        }
      }
    }
    queue = next;
  }

  for (const leaf of leaves.values()) {
    let mask = 0;
    for (const edge of [0, 1, 2, 3] as Edge[]) {
      const neighbour = holding(beyondEdge(leaf.key, edge, 1)[0]);
      if (neighbour && neighbour.key.level < leaf.key.level) mask |= 1 << edge;
    }
    leaf.coarserEdges = mask;
  }

  const drawn = [...leaves.values()].filter((leaf) => !leaf.culled).sort((a, b) => a.key.level - b.key.level);
  return { leaves, drawn, balanceSplits, pinnedConflicts, holding };
}
