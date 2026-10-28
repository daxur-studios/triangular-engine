import { poseView, resolveCamera, frustumNormals, panView, type CameraView } from './lod-camera';
import { BACKSTOP_VALUE, countCracks } from './lod-crack-probe';
import { EDGE_STEP, FACE_FRAMES, cubePoint, domainPoint, domainPreset, neighbourCell, warpCoordinate, type LodDomain, type NeighbourCell, type Vec3 } from './lod-domain';
import { createHeightSource, type NodeHeightRanges } from './lod-height';
import { bakeHeights, type BakeLayout } from './lod-height-bake';
import { noiseSampler } from './lod-height-noise';
import { createTextureHeightSource } from './lod-height-texture';
import { createLodSurfaceMesh } from './lod-surface-mesh';
import { anchorFor, cubeLattice, foldedGrid, gridLattice, latticeSteps, leafLattice, planeVertexF32, smallSinF32, sphereVertexF32 } from './lod-lattice';
import { LEAF_STRIDE, packLeaves } from './lod-leaf-pack';
import { CAP_SLACK, LodSelector, PIXEL_FLOOR, maxLevelFor, type SelectorSettings, type SelectorView } from './lod-selector';
import { createLodSurfaceTestAdapter, settingsMismatches, type LodSurfaceTestHost } from './lod-surface-test-adapter';
import type { LodSurfaceTestSettings } from './lod-surface-tests';
import type { TestContext, TestScenario } from 'triangular-engine/testing';
import { DEFAULT_SETTINGS, LOD_SURFACE_TEST_HISTORY, TURN_UNCAPPED_LEAVES, crackExpectation } from './lod-surface-tests';

const sphere600 = domainPreset('sphere-600km');
const plane = domainPreset('plane-100km');

function settingsFor(domain: LodDomain, change: Partial<SelectorSettings> = {}): SelectorSettings {
  return {
    domain, patchCells: 32, mode: 'distance', fixedLevel: 3, cellPixels: 4, leafCap: 1024,
    heightBoundM: createHeightSource('bumps', domain.kind).boundM, cull: false, ...change,
  };
}

/** A view from a pose, pixel angle of a 1440-pixel-high 60 degree screen. */
function viewFor(domain: LodDomain, pose: Parameters<typeof poseView>[0]): SelectorView {
  const camera = resolveCamera(poseView(pose, domain), domain, createHeightSource('bumps', domain.kind));
  const fov = Math.PI / 3;
  return { camera: camera.position, pixelAngle: (2 * Math.tan(fov / 2)) / 1440, frustum: frustumNormals(camera, fov, 16 / 9, new Float64Array(12)) };
}

/** Every leaf's coarser neighbour is exactly one level up, and its mask says so. */
function balanceIssues(selector: LodSelector, domain: LodDomain): string[] {
  const issues: string[] = [];
  const cell: NeighbourCell = { root: 0, i: 0, j: 0 };
  for (let k = 0; k < selector.stats.leaves; k++) {
    const node = selector.leaves[k];
    const level = selector.level[node];
    for (let e = 0; e < 4; e++) {
      if (!neighbourCell(domain, selector.root[node], level, selector.i[node], selector.j[node], e, cell)) continue;
      const other = selector.findCovering(cell.root, level, cell.i, cell.j);
      const coarser = selector.level[other] < level;
      if (coarser && level - selector.level[other] !== 1) issues.push(`leaf ${node} edge ${e}: neighbour ${level - selector.level[other]} levels up`);
      if (coarser !== ((selector.masks[k] >> e) & 1) > 0) issues.push(`leaf ${node} edge ${e}: mask ${selector.masks[k]} disagrees`);
    }
  }
  return issues;
}

function coveredArea(selector: LodSelector): number {
  let area = 0;
  for (let k = 0; k < selector.stats.leaves; k++) area += 4 ** -selector.level[selector.leaves[k]];
  return area;
}

describe('Plan 059 LOD domain', () => {
  it('warps exactly to the face edge and stays odd', () => {
    expect(warpCoordinate(0, 'equal-angle')).toBe(-1);
    expect(warpCoordinate(1, 'equal-angle')).toBe(1);
    expect(warpCoordinate(0.5, 'equal-angle')).toBe(0);
    for (const u of [0.1, 0.25, 0.4]) expect(warpCoordinate(1 - u, 'equal-angle')).toBe(-warpCoordinate(u, 'equal-angle'));
  });

  it('maps shared cube-edge vertices of neighbouring faces to the same point', () => {
    const level = 3;
    const cells = 2 ** level;
    const cell: NeighbourCell = { root: 0, i: 0, j: 0 };
    const a: Vec3 = [0, 0, 0];
    const b: Vec3 = [0, 0, 0];
    for (const warp of ['equal-angle', 'none'] as const) {
      const domain = domainPreset('sphere-10km', warp);
      for (let face = 0; face < 6; face++) {
        for (let e = 0; e < 4; e++) {
          for (let k = 0; k < cells; k++) {
            const i = e === 1 ? cells - 1 : e === 3 ? 0 : k;
            const j = e === 2 ? cells - 1 : e === 0 ? 0 : k;
            expect(neighbourCell(domain, face, level, i, j, e, cell)).toBeTrue();
            if (cell.root === face) continue;
            // Every corner of this cell on the shared edge is a corner of the neighbour cell.
            const corners = [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]];
            const onEdge = corners.filter(([ci, cj]) => (e === 0 && cj === 0) || (e === 1 && ci === cells) || (e === 2 && cj === cells) || (e === 3 && ci === 0));
            expect(onEdge.length).toBe(2);
            for (const [ci, cj] of onEdge) {
              cubePoint(face, ci / cells, cj / cells, warp, a);
              const matches = [[0, 0], [1, 0], [0, 1], [1, 1]].some(([di, dj]) => {
                const p = cubePoint(cell.root, (cell.i + di) / cells, (cell.j + dj) / cells, warp, b);
                return p[0] === a[0] && p[1] === a[1] && p[2] === a[2];
              });
              expect(matches).withContext(`face ${face} edge ${e} cell ${k} -> face ${cell.root}`).toBeTrue();
            }
          }
        }
      }
    }
  });

  it('finds neighbours across faces symmetrically', () => {
    const cell: NeighbourCell = { root: 0, i: 0, j: 0 };
    const back: NeighbourCell = { root: 0, i: 0, j: 0 };
    for (const level of [0, 1, 4]) {
      const cells = 2 ** level;
      for (let face = 0; face < 6; face++) {
        for (let e = 0; e < 4; e++) {
          for (let k = 0; k < cells; k++) {
            const i = e === 1 ? cells - 1 : e === 3 ? 0 : k;
            const j = e === 2 ? cells - 1 : e === 0 ? 0 : k;
            neighbourCell(sphere600, face, level, i, j, e, cell);
            expect(cell.root).not.toBe(face);
            // Some edge of the neighbour leads back to this cell.
            const found = [0, 1, 2, 3].some((f) => neighbourCell(sphere600, cell.root, level, cell.i, cell.j, f, back) && back.root === face && back.i === i && back.j === j);
            expect(found).withContext(`level ${level} face ${face} edge ${e} cell ${k}`).toBeTrue();
          }
        }
      }
    }
  });

  it('has no neighbour past the plane border and steps inside it', () => {
    const cell: NeighbourCell = { root: 0, i: 0, j: 0 };
    expect(neighbourCell(plane, 0, 2, 0, 1, 3, cell)).toBeFalse();
    expect(neighbourCell(plane, 0, 2, 1, 1, 3, cell)).toBeTrue();
    expect([cell.i, cell.j]).toEqual([0, 1]);
    expect(EDGE_STEP.length).toBe(4);
  });

  it('puts sphere points on the radius with outward normals', () => {
    const p: Vec3 = [0, 0, 0];
    const n: Vec3 = [0, 0, 0];
    domainPoint(sphere600, 4, 0.3, 0.7, p, n);
    expect(Math.hypot(...p)).toBeCloseTo(600_000, 6);
    expect(p[0] * n[0] + p[1] * n[1] + p[2] * n[2]).toBeCloseTo(600_000, 6);
  });
});

describe('Plan 059 LOD selector', () => {
  it('builds the uniform baseline: 6 x 4^L leaves, no coarser edges', () => {
    const selector = new LodSelector(settingsFor(sphere600, { mode: 'fixed', fixedLevel: 3 }));
    selector.select(viewFor(sphere600, 'orbit'));
    expect(selector.stats.leaves).toBe(6 * 4 ** 3);
    expect(selector.stats.capHit).toBeFalse();
    for (let k = 0; k < selector.stats.leaves; k++) expect(selector.masks[k]).toBe(0);
  });

  for (const [label, domain] of [['plane', plane], ['sphere 600 km', sphere600], ['sphere 10 km', domainPreset('sphere-10km')]] as const) {
    for (const pose of ['eye-2m', 'horizon', 'mid-5km'] as const) {
      it(`keeps 2:1 balance, whole cover and right masks (${label}, ${pose})`, () => {
        const selector = new LodSelector(settingsFor(domain, { cull: true }));
        selector.select(viewFor(domain, pose));
        expect(selector.stats.leaves).toBeGreaterThan(20);
        expect(balanceIssues(selector, domain)).toEqual([]);
        expect(coveredArea(selector)).toBeCloseTo(domain.kind === 'plane' ? 1 : 6, 12);
        expect(selector.stats.leaves).toBeLessThanOrEqual(1024 + CAP_SLACK);
      });
    }
  }

  it('refines toward the camera: the leaf under a 2 m eye is the deepest', () => {
    const selector = new LodSelector(settingsFor(sphere600));
    const view = viewFor(sphere600, 'eye-2m');
    selector.select(view);
    let nearest = -1;
    let nearestDistance = Infinity;
    for (let k = 0; k < selector.stats.leaves; k++) {
      const node = selector.leaves[k];
      const d = Math.hypot(selector.center[node * 3] - view.camera[0], selector.center[node * 3 + 1] - view.camera[1], selector.center[node * 3 + 2] - view.camera[2]);
      if (d < nearestDistance) { nearestDistance = d; nearest = node; }
    }
    expect(selector.level[nearest]).toBe(selector.stats.deepestLevel);
    expect(selector.stats.deepestLevel).toBeGreaterThan(10);
  });

  it('stops at the cap with whole cover and counts what it could not do', () => {
    const selector = new LodSelector(settingsFor(sphere600, { leafCap: 64 }));
    selector.select(viewFor(sphere600, 'eye-2m'));
    expect(selector.stats.capHit).toBeTrue();
    expect(selector.stats.unmet).toBeGreaterThan(0);
    expect(selector.stats.leaves).toBeLessThanOrEqual(64 + CAP_SLACK);
    expect(coveredArea(selector)).toBeCloseTo(6, 12);
    expect(balanceIssues(selector, sphere600)).toEqual([]);
  });

  it('never goes past the deepest exact level', () => {
    for (const patchCells of [16, 64] as const) {
      const selector = new LodSelector(settingsFor(plane, { patchCells, cellPixels: 2, leafCap: 4096 }));
      selector.select(viewFor(plane, 'eye-2m'));
      expect(selector.stats.deepestLevel).toBeLessThanOrEqual(maxLevelFor(patchCells));
    }
  });

  it('reuses its storage and gives the same tree for the same view', () => {
    const selector = new LodSelector(settingsFor(sphere600, { cull: true }));
    const view = viewFor(sphere600, 'low-200m');
    selector.select(view);
    const leaves = selector.leaves;
    const first = Array.from(selector.leaves.subarray(0, selector.stats.leaves));
    for (let k = 0; k < 20; k++) selector.select(view);
    expect(selector.leaves).toBe(leaves);
    expect(Array.from(selector.leaves.subarray(0, selector.stats.leaves))).toEqual(first);
  });

  it('selects the same cells as a fresh selector after many views, through pool reclaims', () => {
    const settings = settingsFor(sphere600, { cull: true, leafCap: 256 });
    const reused = new LodSelector(settings, 2);
    const cellsOf = (selector: LodSelector): string[] => {
      const keys: string[] = [];
      for (let k = 0; k < selector.stats.leaves; k++) {
        const node = selector.leaves[k];
        keys.push(`${selector.root[node]}:${selector.level[node]}:${selector.i[node]}:${selector.j[node]}:${selector.masks[k]}:${k < selector.stats.drawn}`);
      }
      return keys.sort();
    };
    // Rotating the camera and frustum about the centre (x, y, z -> y, z, x) looks at other faces of the same sphere.
    const rotate = (v: SelectorView, turns: number): SelectorView => {
      const turn = (x: number, y: number, z: number): Vec3 => {
        let p: Vec3 = [x, y, z];
        for (let t = 0; t < turns; t++) p = [p[1], p[2], p[0]];
        return p;
      };
      const frustum = new Float64Array(12);
      for (let p = 0; p < 12; p += 3) frustum.set(turn(v.frustum[p], v.frustum[p + 1], v.frustum[p + 2]), p);
      return { camera: turn(...v.camera), pixelAngle: v.pixelAngle, frustum };
    };
    for (let round = 0; round < 2; round++) {
      for (const pose of ['eye-2m', 'horizon', 'low-200m', 'mid-5km', 'orbit'] as const) {
        for (let turns = 0; turns < 3; turns++) {
          const view = rotate(viewFor(sphere600, pose), turns);
          reused.select(view);
          const fresh = new LodSelector(settings);
          fresh.select(view);
          expect(cellsOf(reused)).withContext(`round ${round} ${pose} turns ${turns}`).toEqual(cellsOf(fresh));
          expect(balanceIssues(reused, sphere600)).toEqual([]);
        }
      }
    }
    expect(reused.reclaims).toBeGreaterThan(0);
  });

  it('culls: fewer drawn leaves than leaves when looking along the ground', () => {
    const selector = new LodSelector(settingsFor(plane, { cull: true }));
    selector.select(viewFor(plane, 'eye-2m'));
    expect(selector.stats.drawn).toBeLessThan(selector.stats.leaves);
    expect(selector.stats.drawn).toBeGreaterThan(0);
  });
});

interface ReferenceStats { leaves: number; drawn: number; splits: number; forcedSplits: number; unmet: number; capHit: boolean; deepestLevel: number }

/**
 * The M1 selection written the plain way, for comparison: no pool, no neighbour pointers, no stamps, no early return.
 * Cells are looked up by key, the balance and the edge masks search the tree from the roots, and the queue is the
 * original swap-based binary heap, so ties pop in the same order as in the selector.
 */
class ReferenceSelector {
  private readonly geometry = new Map<string, { centre: Vec3; up: Vec3; ground: number; radius: number; edge: number }>();
  leaves: string[] = [];
  stats!: ReferenceStats;

  constructor(private readonly settings: SelectorSettings) {}

  select(view: SelectorView): void {
    const { domain, patchCells, leafCap, cull, mode, fixedLevel } = this.settings;
    interface Node { root: number; level: number; i: number; j: number; open: boolean; visible: boolean; priority: number }
    const maxLevel = maxLevelFor(patchCells);
    const treeCapacity = 2 * (leafCap + CAP_SLACK) + 64;
    const key = (root: number, level: number, i: number, j: number) => `${root}:${level}:${i}:${j}`;
    const nodes = new Map<string, Node>();
    const order: Node[] = [];
    const heap: Node[] = [];
    const stats: ReferenceStats = { leaves: 0, drawn: 0, splits: 0, forcedSplits: 0, unmet: 0, capHit: false, deepestLevel: 0 };
    const roots = domain.kind === 'plane' ? 1 : 6;
    let leafCount = roots;
    const cell: NeighbourCell = { root: 0, i: 0, j: 0 };

    const geometryOf = (n: Node) => {
      const k = key(n.root, n.level, n.i, n.j);
      let g = this.geometry.get(k);
      if (!g) {
        const size = 1 / 2 ** n.level;
        const centre: Vec3 = [0, 0, 0];
        const normal: Vec3 = [0, 0, 0];
        domainPoint(domain, n.root, (n.i + 0.5) * size, (n.j + 0.5) * size, centre, normal);
        const up: Vec3 = [normal[0], normal[1], normal[2]];
        const corners = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]].map(([di, dj]) => {
          const p: Vec3 = [0, 0, 0];
          domainPoint(domain, n.root, (n.i + di) * size, (n.j + dj) * size, p, normal);
          return p;
        });
        let radius = 0;
        let edge = 0;
        corners.forEach((p, c) => {
          if (c < 4) radius = Math.max(radius, Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]));
          if (c > 0) edge = Math.max(edge, Math.hypot(p[0] - corners[c - 1][0], p[1] - corners[c - 1][1], p[2] - corners[c - 1][2]));
        });
        g = { centre, up, ground: radius, radius: radius + this.settings.heightBoundM, edge };
        this.geometry.set(k, g);
      }
      return g;
    };
    const priorityOf = (n: Node): number => {
      if (n.level >= maxLevel) return 0;
      if (mode === 'fixed') return n.level < fixedLevel ? 1 + fixedLevel - n.level : 0;
      const g = geometryOf(n);
      const x = g.centre[0] - view.camera[0];
      const y = g.centre[1] - view.camera[1];
      const z = g.centre[2] - view.camera[2];
      // Distance to the node's split box: `ground` across, the height bound up and down along the normal.
      const along = Math.abs(x * g.up[0] + y * g.up[1] + z * g.up[2]);
      const across = Math.sqrt(Math.max(x * x + y * y + z * z - along * along, 0));
      const gap = Math.max(Math.hypot(Math.max(across - g.ground, 0), Math.max(along - this.settings.heightBoundM, 0)), 1e-3);
      const target = Math.max(this.settings.cellPixels, PIXEL_FLOOR) * view.pixelAngle * gap;
      return g.edge / patchCells / target;
    };
    const visibleOf = (n: Node): boolean => {
      if (!cull) return true;
      const g = geometryOf(n);
      const x = g.centre[0] - view.camera[0];
      const y = g.centre[1] - view.camera[1];
      const z = g.centre[2] - view.camera[2];
      for (let p = 0; p < 12; p += 3) if (view.frustum[p] * x + view.frustum[p + 1] * y + view.frustum[p + 2] * z < -g.radius) return false;
      return true;
    };
    const push = (n: Node) => {
      if (n.priority <= 1) return;
      let k = heap.length;
      heap.push(n);
      while (k > 0) {
        const parent = (k - 1) >> 1;
        if (heap[parent].priority >= heap[k].priority) break;
        [heap[parent], heap[k]] = [heap[k], heap[parent]];
        k = parent;
      }
    };
    const pop = (): Node => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length > 0) heap[0] = last;
      let k = 0;
      while (true) {
        const left = 2 * k + 1;
        const right = left + 1;
        let best = k;
        if (left < heap.length && heap[left].priority > heap[best].priority) best = left;
        if (right < heap.length && heap[right].priority > heap[best].priority) best = right;
        if (best === k) break;
        [heap[best], heap[k]] = [heap[k], heap[best]];
        k = best;
      }
      return top;
    };
    const activate = (root: number, level: number, i: number, j: number) => {
      const n: Node = { root, level, i, j, open: false, visible: false, priority: 0 };
      n.visible = visibleOf(n);
      n.priority = n.visible ? priorityOf(n) : 0;
      nodes.set(key(root, level, i, j), n);
      order.push(n);
      push(n);
    };
    /** The deepest node at or above `level` covering the cell, searching down from its root. */
    const covering = (root: number, level: number, i: number, j: number): Node => {
      for (let l = 0; l < level; l++) {
        const ancestor = nodes.get(key(root, l, i >>> (level - l), j >>> (level - l)))!;
        if (!ancestor.open) return ancestor;
      }
      return nodes.get(key(root, level, i, j))!;
    };
    const across = (n: Node, e: number): Node | undefined =>
      neighbourCell(domain, n.root, n.level, n.i, n.j, e, cell) ? covering(cell.root, n.level, cell.i, cell.j) : undefined;
    const split = (n: Node, forced: boolean): boolean => {
      if (n.level >= maxLevel || order.length + 4 > treeCapacity) return false;
      if (leafCount + 3 > leafCap + CAP_SLACK) return false;
      for (let e = 0; e < 4; e++) {
        const other = across(n, e);
        if (other && other.level < n.level && !other.open && !split(other, true)) return false;
      }
      n.open = true;
      leafCount += 3;
      if (forced) stats.forcedSplits++;
      else stats.splits++;
      for (let k = 0; k < 4; k++) activate(n.root, n.level + 1, n.i * 2 + (k & 1), n.j * 2 + (k >> 1));
      return true;
    };

    for (let r = 0; r < roots; r++) activate(r, 0, 0, 0);
    while (heap.length > 0) {
      const n = pop();
      if (n.open) continue;
      if (leafCount + 3 > leafCap || !split(n, false)) {
        push(n);
        stats.capHit = true;
        break;
      }
    }
    stats.unmet = heap.filter((n) => !n.open).length;
    const describeLeaf = (n: Node) => {
      let mask = 0;
      for (let e = 0; e < 4; e++) {
        const other = across(n, e);
        if (other && other.level < n.level) mask |= 1 << e;
      }
      stats.deepestLevel = Math.max(stats.deepestLevel, n.level);
      return `${key(n.root, n.level, n.i, n.j)}:${mask}`;
    };
    const leaves = order.filter((n) => !n.open);
    const drawn = leaves.filter((n) => n.visible);
    this.leaves = [...drawn, ...leaves.filter((n) => !n.visible)].map(describeLeaf);
    stats.leaves = leaves.length;
    stats.drawn = drawn.length;
    this.stats = stats;
  }
}

/** The selector's leaves as the reference describes them: `root:level:i:j:mask`, drawn first, in tree order. */
function leavesOf(selector: LodSelector): string[] {
  const out: string[] = [];
  for (let k = 0; k < selector.stats.leaves; k++) {
    const node = selector.leaves[k];
    out.push(`${selector.root[node]}:${selector.level[node]}:${selector.i[node]}:${selector.j[node]}:${selector.masks[k]}`);
  }
  return out;
}

/** The selector's stats as the reference counts them: the level-churn counters (`newSplits`, `merges`) are new and left out. */
function statsOf(selector: LodSelector): ReferenceStats {
  const { leaves, drawn, splits, forcedSplits, unmet, capHit, deepestLevel } = selector.stats;
  return { leaves, drawn, splits, forcedSplits, unmet, capHit, deepestLevel };
}

/** The selector view for a camera view, with the same 60 degree, 1440-pixel screen as {@link viewFor}. */
function viewOfCamera(domain: LodDomain, view: CameraView): SelectorView {
  const camera = resolveCamera(view, domain, createHeightSource('bumps', domain.kind));
  const fov = Math.PI / 3;
  return { camera: camera.position, pixelAngle: (2 * Math.tan(fov / 2)) / 1440, frustum: frustumNormals(camera, fov, 16 / 9, new Float64Array(12)) };
}

describe('Plan 059 selector against the plain reference', () => {
  const POSE_IDS = ['eye-2m', 'low-200m', 'mid-5km', 'horizon', 'orbit'] as const;

  for (const [label, domain] of [['plane', plane], ['sphere 600 km', sphere600]] as const) {
    for (const [mode, leafCap] of [['distance', 64], ['distance', 300], ['distance', 1024], ['fixed', 700]] as const) {
      for (const cull of [true, false]) {
        it(`picks the same leaves, masks, order and stats while the camera moves (${label}, ${mode}, cap ${leafCap}, cull ${cull})`, () => {
          const settings = settingsFor(domain, { cull, leafCap, mode, fixedLevel: 4 });
          const selector = new LodSelector(settings, 2);
          const reference = new ReferenceSelector(settings);
          for (const pose of POSE_IDS) {
            // Jump to the pose, then fly: 1% of the altitude per frame ahead, with a pan and a turn every few frames.
            let camera: CameraView = poseView(pose, domain);
            for (let frame = 0; frame < 8; frame++) {
              camera = panView(camera, frame % 4 === 3 ? 0.004 : 0, 0.01 / 1.5, domain);
              if (frame % 5 === 4) camera = { ...camera, headingRad: camera.headingRad + 0.3 };
              const view = viewOfCamera(domain, camera);
              selector.select(view);
              reference.select(view);
              expect(leavesOf(selector)).withContext(`${pose} frame ${frame}`).toEqual(reference.leaves);
              expect(statsOf(selector)).withContext(`${pose} frame ${frame}`).toEqual(reference.stats);
            }
          }
        });
      }
    }
  }

  for (const [label, domain] of [['plane', plane], ['sphere 600 km', sphere600]] as const) {
    it(`gives the reference's leaves, masks and stats with the hysteresis set to 0, and the same churn as a hysteresis-free run (${label})`, () => {
      const settings = settingsFor(domain, { cull: true, leafCap: 300, hysteresis: 0 });
      const selector = new LodSelector(settings, 2);
      const absent = new LodSelector(settingsFor(domain, { cull: true, leafCap: 300 }), 2);
      const reference = new ReferenceSelector(settings);
      for (const pose of POSE_IDS) {
        let camera: CameraView = poseView(pose, domain);
        for (let frame = 0; frame < 8; frame++) {
          camera = panView(camera, frame % 4 === 3 ? 0.004 : 0, 0.01 / 1.5, domain);
          const view = viewOfCamera(domain, camera);
          selector.select(view);
          absent.select(view);
          reference.select(view);
          expect(leavesOf(selector)).withContext(`${pose} frame ${frame}`).toEqual(reference.leaves);
          expect(statsOf(selector)).withContext(`${pose} frame ${frame}`).toEqual(reference.stats);
          expect({ ...selector.stats }).withContext(`${pose} frame ${frame}`).toEqual({ ...absent.stats });
        }
      }
    });
  }

  it('hits the cap in the capped cases, so the priority order decides what is split', () => {
    const selector = new LodSelector(settingsFor(sphere600, { cull: true, leafCap: 300 }));
    selector.select(viewOfCamera(sphere600, poseView('horizon', sphere600)));
    expect(selector.stats.capHit).toBeTrue();
    expect(selector.stats.unmet).toBeGreaterThan(0);
  });

  it('links every neighbour pointer to the cell across the edge, and gives the search-based masks', () => {
    const settings = settingsFor(sphere600, { cull: true, leafCap: 256 });
    const selector = new LodSelector(settings, 2);
    const cell: NeighbourCell = { root: 0, i: 0, j: 0 };
    for (const pose of POSE_IDS) {
      for (let turn = 0; turn < 2; turn++) {
        let camera: CameraView = { ...poseView(pose, sphere600), headingRad: turn };
        for (let frame = 0; frame < 4; frame++) {
          camera = panView(camera, 0.002, 0.01 / 1.5, sphere600);
          selector.select(viewOfCamera(sphere600, camera));
          for (let k = 0; k < selector.activeCount; k++) {
            const node = selector.active[k];
            const level = selector.level[node];
            for (let e = 0; e < 4; e++) {
              const linked = selector.nb[node * 4 + e];
              expect(neighbourCell(sphere600, selector.root[node], level, selector.i[node], selector.j[node], e, cell)).toBeTrue();
              if (linked === selector.unlinked) {
                // No node for that cell yet, so a coarser leaf covers it.
                expect(selector.level[selector.findCovering(cell.root, level, cell.i, cell.j)]).toBeLessThan(level);
                continue;
              }
              expect([selector.root[linked], selector.level[linked], selector.i[linked], selector.j[linked]]).toEqual([cell.root, level, cell.i, cell.j]);
            }
          }
          for (let k = 0; k < selector.stats.leaves; k++) expect(selector.masks[k]).toBe(selector.edgeMask(selector.leaves[k]));
        }
      }
    }
  });

  it('reclaims blocks of nodes in a small pool and still selects what the reference does', () => {
    const settings = settingsFor(sphere600, { cull: true, leafCap: 1024 });
    const selector = new LodSelector(settings, 2);
    const reference = new ReferenceSelector(settings);
    for (let round = 0; round < 3; round++) {
      for (const pose of POSE_IDS) {
        const view = viewOfCamera(sphere600, poseView(pose, sphere600));
        selector.select(view);
        reference.select(view);
        expect(leavesOf(selector)).withContext(pose).toEqual(reference.leaves);
      }
    }
    expect(selector.reclaims).toBeGreaterThan(0);
  });

  it('points at the stand-in for no neighbour on the plane border and nowhere else', () => {
    const selector = new LodSelector(settingsFor(plane, { cull: false }));
    selector.select(viewFor(plane, 'eye-2m'));
    for (let k = 0; k < selector.activeCount; k++) {
      const node = selector.active[k];
      const cells = 2 ** selector.level[node];
      const border = [selector.j[node] === 0, selector.i[node] === cells - 1, selector.j[node] === cells - 1, selector.i[node] === 0];
      for (let e = 0; e < 4; e++) expect(selector.nb[node * 4 + e] === selector.none).toBe(border[e]);
    }
  });

  it('returns without redoing the tree for an identical view, and rebuilds for any change', () => {
    const selector = new LodSelector(settingsFor(sphere600, { cull: true }));
    const view = viewFor(sphere600, 'low-200m');
    selector.select(view);
    const version = selector.version;
    const first = leavesOf(selector);
    selector.select({ camera: [...view.camera] as Vec3, pixelAngle: view.pixelAngle, frustum: Float64Array.from(view.frustum) });
    expect(selector.version).toBe(version);
    expect(leavesOf(selector)).toEqual(first);
    selector.select({ ...view, pixelAngle: view.pixelAngle * 50 });
    expect(selector.version).toBe(version + 1);
    expect(leavesOf(selector).length).toBeLessThan(first.length);
    const turned = Float64Array.from(view.frustum);
    turned[0] += 1e-6;
    selector.select({ ...view, frustum: turned });
    expect(selector.version).toBe(version + 2);
    selector.select(view);
    expect(leavesOf(selector)).toEqual(first);
  });
});

describe('Plan 059 leaf packing and frustum', () => {
  it('writes each drawn leaf as lattice origin, step, face, level and mask, and no more than the capacity', () => {
    const selector = new LodSelector(settingsFor(sphere600, { cull: true }));
    selector.select(viewFor(sphere600, 'low-200m'));
    const maxLevel = maxLevelFor(32);
    const leafData = new Float32Array(2048 * LEAF_STRIDE);
    const infoData = new Float32Array(2048 * LEAF_STRIDE);
    const count = packLeaves(selector, 32, maxLevel, 2048, leafData, infoData);
    expect(count).toBe(selector.stats.drawn);
    for (let k = 0; k < count; k++) {
      const node = selector.leaves[k];
      const step = 2 ** (maxLevel - selector.level[node]);
      expect(Array.from(leafData.subarray(k * 4, k * 4 + 4))).toEqual([selector.i[node] * 32 * step, selector.j[node] * 32 * step, step, selector.root[node]]);
      expect(Array.from(infoData.subarray(k * 4, k * 4 + 4))).toEqual([selector.level[node], selector.masks[k], 0, 0]);
    }
    expect(packLeaves(selector, 32, maxLevel, 10, leafData, infoData)).toBe(10);
  });

  it('uploads only when the selection changed, and for a different selector', () => {
    const source = createHeightSource('bumps', sphere600.kind);
    const surface = createLodSurfaceMesh({ domain: sphere600, patchCells: 32, source, capacity: 2048 });
    const attribute = surface.mesh.geometry.getAttribute('aLeaf') as unknown as { version: number; updateRanges: { start: number; count: number }[] };
    const selector = new LodSelector(settingsFor(sphere600, { cull: true }));
    const view = viewFor(sphere600, 'low-200m');
    selector.select(view);
    const count = surface.upload(selector, view.camera);
    const uploaded = attribute.version;
    const ranges = attribute.updateRanges;
    expect(ranges.length).toBe(1);
    expect(ranges[0].count).toBe(count * 4);
    selector.select(view);
    surface.upload(selector, view.camera);
    expect(attribute.version).toBe(uploaded);
    selector.select(viewFor(sphere600, 'mid-5km'));
    surface.upload(selector, view.camera);
    expect(attribute.version).toBe(uploaded + 1);
    expect(attribute.updateRanges).toBe(ranges);
    const other = new LodSelector(settingsFor(sphere600, { cull: true }));
    other.select(viewFor(sphere600, 'mid-5km'));
    surface.upload(other, view.camera);
    expect(attribute.version).toBe(uploaded + 2);
    surface.dispose();
  });

  it('gives the frustum side planes of the earlier formula, bit for bit', () => {
    const fov = Math.PI / 3;
    for (const pose of ['eye-2m', 'horizon', 'orbit'] as const) {
      const camera = resolveCamera(poseView(pose, sphere600), sphere600, createHeightSource('bumps', 'sphere'));
      const expected = new Float64Array(12);
      const ay = fov / 2;
      const ax = Math.atan(Math.tan(ay) * (16 / 9));
      const planes: [Vec3, number][] = [[camera.right, ax], [camera.right, -ax], [camera.up, ay], [camera.up, -ay]];
      planes.forEach(([axis, angle], p) => {
        const sign = Math.sign(angle);
        const a = Math.abs(angle);
        for (let k = 0; k < 3; k++) expected[p * 3 + k] = sign * Math.cos(a) * axis[k] + Math.sin(a) * camera.forward[k];
      });
      const out = new Float64Array(12);
      expect(frustumNormals(camera, fov, 16 / 9, out)).toBe(out);
      expect(Array.from(out)).toEqual(Array.from(expected));
    }
  });
});

describe('Plan 059 vertex offset (shader formula, in doubles)', () => {
  it('equals the direct difference of normalised cube points', () => {
    const R = 600_000;
    for (const [face, uC, vC, du] of [[0, 0.3, 0.6, 1 / 64], [4, 0.97, 0.99, 1 / 1024], [2, 0.5, 0.0625, 1 / 8]] as const) {
      for (const [fx, fy] of [[0, 0], [1, 1], [0.25, 0.75]]) {
        const cC = cubePoint(face, uC, vC, 'equal-angle');
        const c = cubePoint(face, uC + (fx - 0.5) * du, vC + (fy - 0.5) * du, 'equal-angle');
        const theta = (u: number) => (Math.PI / 4) * (2 * u - 1);
        const delta = (u: number, uc: number) => Math.sin((Math.PI / 2) * (u - uc)) / (Math.cos(theta(u)) * Math.cos(theta(uc)));
        const a = delta(uC + (fx - 0.5) * du, uC);
        const b = delta(vC + (fy - 0.5) * du, vC);
        expect(a).toBeCloseTo(warpCoordinate(uC + (fx - 0.5) * du, 'equal-angle') - warpCoordinate(uC, 'equal-angle'), 12);
        const frames = [[0, 0, -1, 0, 1, 0], [0, 0, 1, 0, 1, 0], [1, 0, 0, 0, 0, -1], [1, 0, 0, 0, 0, 1], [1, 0, 0, 0, 1, 0], [-1, 0, 0, 0, 1, 0]][face];
        const dc = [0, 1, 2].map((k) => a * frames[k] + b * frames[3 + k]);
        const lc = Math.hypot(...c);
        const lC = Math.hypot(...cC);
        const dot = dc.reduce((sum, value, k) => sum + value * (2 * cC[k] + value), 0);
        for (let k = 0; k < 3; k++) {
          const formula = R * (dc[k] / lc - (cC[k] * dot) / (lc * lC * (lc + lC)));
          const direct = R * (c[k] / lc - cC[k] / lC);
          expect(formula).toBeCloseTo(direct, 6);
        }
      }
    }
  });
});

describe('Plan 059 small-angle sine (shader polynomial, in float steps)', () => {
  it('keeps float relative accuracy from deep-leaf offsets up to a quarter turn', () => {
    for (const x of [1e-7, 3e-6, 1e-4, 0.01, 0.3, Math.PI / 4, 0.85, 1.3, Math.PI / 2]) {
      const exact = Math.sin(Math.fround(x));
      expect(Math.abs(smallSinF32(x) - exact) / exact).toBeLessThan(1e-6);
    }
  });
});

describe('Plan 059 bit-identical seam lattice', () => {
  const cells = 32;
  const maxLevel = maxLevelFor(cells);
  const steps = latticeSteps(cells, maxLevel);
  const bitsOf = (v: readonly number[]) => v.map((x) => Math.fround(x)).join(',');

  it('uses 2^24 lattice steps per face side for every patch size', () => {
    for (const c of [16, 32, 64] as const) expect(latticeSteps(c, maxLevelFor(c))).toBe(2 ** 24);
  });

  it('addresses a shared edge vertex by the same lattice point from same-level neighbours', () => {
    const west = leafLattice(0, 5, 3, 7, cells, maxLevel);
    const east = leafLattice(0, 5, 4, 7, cells, maxLevel);
    for (let g = 0; g <= cells; g++) expect(gridLattice(west, cells, g)).toEqual(gridLattice(east, 0, g));
    const south = leafLattice(0, 5, 3, 6, cells, maxLevel);
    for (let g = 0; g <= cells; g++) expect(gridLattice(west, g, 0)).toEqual(gridLattice(south, g, cells));
    const deep = leafLattice(0, maxLevel, 2 ** maxLevel - 1, 2 ** maxLevel - 1, cells, maxLevel);
    expect(gridLattice(deep, cells, cells)).toEqual([steps, steps]);
  });

  it('gives the same float position on the sphere and the plane for same-level neighbours', () => {
    const camera: Vec3 = [1_234_567, 2_345_678, 3_456_789];
    for (const domain of [sphere600, plane, domainPreset('sphere-600km', 'none')]) {
      const isPlane = domain.kind === 'plane';
      const anchor = anchorFor(domain, isPlane ? [30_000, 2, -10_000] : camera, steps);
      const west = leafLattice(isPlane ? 0 : 4, 7, 100, 61, cells, maxLevel);
      const east = leafLattice(west.root, 7, 101, 61, cells, maxLevel);
      for (let g = 0; g <= cells; g++) {
        const [u1, v1] = gridLattice(west, cells, g);
        const [u2, v2] = gridLattice(east, 0, g);
        const a = isPlane ? planeVertexF32(domain, steps, u1, v1, anchor) : sphereVertexF32(domain, steps, cubeLattice(west.root, u1, v1, steps), anchor);
        const b = isPlane ? planeVertexF32(domain, steps, u2, v2, anchor) : sphereVertexF32(domain, steps, cubeLattice(east.root, u2, v2, steps), anchor);
        expect(bitsOf(a)).toBe(bitsOf(b));
      }
    }
  });

  it('folds a fine edge vertex exactly onto the coarse neighbour vertex, with identical float positions', () => {
    const anchor = anchorFor(sphere600, [10, 5_000, 599_000], steps);
    // Fine leaves (level 5, i = 15) sit west of a coarse leaf (level 4, i = 8): their east edge, mask bit 1, is the coarser one.
    const coarse = leafLattice(4, 4, 8, 1, cells, maxLevel);
    for (const j of [2, 3]) {
      const fine = leafLattice(4, 5, 15, j, cells, maxLevel);
      for (let g = 0; g <= cells; g++) {
        const [fx, fy] = foldedGrid(cells, g, cells, 1 << 1);
        const [u, v] = gridLattice(fine, fx, fy);
        const gy = (v - coarse.v0) / coarse.step;
        expect(Number.isInteger(gy) && gy >= 0 && gy <= cells).toBeTrue();
        expect(gridLattice(coarse, 0, gy)).toEqual([u, v]);
        const a = sphereVertexF32(sphere600, steps, cubeLattice(4, u, v, steps), anchor);
        const [cu, cv] = gridLattice(coarse, 0, gy);
        const b = sphereVertexF32(sphere600, steps, cubeLattice(4, cu, cv, steps), anchor);
        expect(bitsOf(a)).toBe(bitsOf(b));
        expect(foldedGrid(cells, g, cells, 1 << 1, false)).toEqual([cells, g]);
      }
    }
    expect(foldedGrid(3, 0, cells, 1)).toEqual([2, 0]);
    expect(foldedGrid(3, 0, cells, 4)).toEqual([3, 0]);
    expect(foldedGrid(3, cells, cells, 4)).toEqual([2, cells]);
    expect(foldedGrid(0, 5, cells, 8)).toEqual([0, 4]);
    expect(foldedGrid(4, 0, cells, 1)).toEqual([4, 0]);
  });

  it('gives one cube-lattice vector, so one position, to a seam vertex from every face that has it', () => {
    let seams = 0;
    for (let f = 0; f < 6; f++) {
      for (const [u, v] of [[steps, 0], [steps, steps], [steps, 12_345_678], [0, 7], [99, steps], [steps - 5, 0]]) {
        const t = cubeLattice(f, u, v, steps);
        const anchor = anchorFor(sphere600, [(u - steps / 2) * 0.05 + 1, 3, 600_000], steps);
        for (let g = 0; g < 6; g++) {
          if (g === f) continue;
          const { n: gn, u: gu, v: gv } = FACE_FRAMES[g];
          if (t[0] * gn[0] + t[1] * gn[1] + t[2] * gn[2] !== steps) continue;
          const dotWith = (axis: Vec3) => t[0] * axis[0] + t[1] * axis[1] + t[2] * axis[2];
          const other = cubeLattice(g, (dotWith(gu) + steps) / 2, (dotWith(gv) + steps) / 2, steps);
          expect(other).toEqual(t);
          expect(bitsOf(sphereVertexF32(sphere600, steps, other, anchor))).toBe(bitsOf(sphereVertexF32(sphere600, steps, t, anchor)));
          seams++;
        }
      }
    }
    expect(seams).toBeGreaterThan(20);
  });

  it('keeps the float position within millimetres of the double position near the camera (eye 2 m, sphere 600 km)', () => {
    const position: Vec3 = [0, 0, 0];
    const normal: Vec3 = [0, 0, 0];
    domainPoint(sphere600, 4, 0.4137, 0.5921, position, normal);
    const camera: Vec3 = [position[0] + normal[0] * 2, position[1] + normal[1] * 2, position[2] + normal[2] * 2];
    const anchor = anchorFor(sphere600, camera, steps);
    const reference: Vec3 = [0, 0, 0];
    const normalOut: Vec3 = [0, 0, 0];
    for (const radius of [0.5, 5, 50, 500, 5000]) {
      for (let k = 0; k < 40; k++) {
        const lu = Math.round((0.4137 + (Math.cos(k * 2.4) * radius) / (sphere600.sizeM * 1.5708)) * steps);
        const lv = Math.round((0.5921 + (Math.sin(k * 2.4) * radius) / (sphere600.sizeM * 1.5708)) * steps);
        domainPoint(sphere600, 4, lu / steps, lv / steps, reference, normalOut);
        const exact = reference.map((value, a) => value - camera[a]);
        const float = sphereVertexF32(sphere600, steps, cubeLattice(4, lu, lv, steps), anchor);
        expect(Math.hypot(float[0] - exact[0], float[1] - exact[1], float[2] - exact[2])).toBeLessThan(2e-3 + radius * 2e-6);
      }
    }
  });

  it('keeps the plane position within a millimetre of the double position near the camera', () => {
    const camera: Vec3 = [12_345.678, 2, -23_456.789];
    const anchor = anchorFor(plane, camera, steps);
    const unit = plane.sizeM / steps;
    for (const [du, dv] of [[0, 0], [300, -4], [-5000, 1200]]) {
      const lu = Math.round((camera[0] / plane.sizeM + 0.5) * steps) + du;
      const lv = Math.round((-camera[2] / plane.sizeM + 0.5) * steps) + dv;
      const exact = [(lu / steps - 0.5) * plane.sizeM - camera[0], -camera[1], -(lv / steps - 0.5) * plane.sizeM - camera[2]];
      const float = planeVertexF32(plane, steps, lu, lv, anchor);
      expect(Math.hypot(float[0] - exact[0], float[1] - exact[1], float[2] - exact[2])).toBeLessThan(1e-3 + Math.hypot(du, dv) * unit * 2e-7);
    }
  });

  it('moves a shrunk vertex only when the gap is on', () => {
    const anchor = anchorFor(sphere600, [0, 0, 600_002], steps);
    const t = cubeLattice(4, steps / 2 + 100, steps / 2 + 200, steps);
    const centre = cubeLattice(4, steps / 2 + 132, steps / 2 + 232, steps);
    const plain = sphereVertexF32(sphere600, steps, t, anchor);
    expect(bitsOf(sphereVertexF32(sphere600, steps, t, anchor, [0, 0, 0], 0, centre))).toBe(bitsOf(plain));
    expect(bitsOf(sphereVertexF32(sphere600, steps, t, anchor, [0, 0, 0], 0.1, centre))).not.toBe(bitsOf(plain));
  });
});

describe('Plan 059 surface mesh construction', () => {
  it('builds the vertex graph and uploads lattice attributes for the sphere and the plane', () => {
    for (const domain of [sphere600, plane]) {
      const source = createHeightSource('bumps', domain.kind);
      const selector = new LodSelector(settingsFor(domain, { mode: 'fixed', fixedLevel: 2 }));
      const view = viewFor(domain, 'eye-2m');
      selector.select(view);
      const surface = createLodSurfaceMesh({ domain, patchCells: 32, source, capacity: 2048 });
      const count = surface.upload(selector, view.camera);
      expect(count).toBe(selector.stats.drawn);
      const leaf = (surface.mesh.geometry.getAttribute('aLeaf') as { array: Float32Array }).array;
      expect(leaf[2]).toBe(2 ** (maxLevelFor(32) - 2));
      surface.dispose();
    }
  });
});

describe('Plan 059 height sources', () => {
  it('stay within their bound', () => {
    for (const kind of ['plane', 'sphere'] as const) {
      const source = createHeightSource('bumps', kind);
      for (let k = 0; k < 500; k++) {
        const h = source.heightAt(Math.sin(k) * 40_000, Math.cos(k * 1.3) * 40_000, Math.sin(k * 0.7) * 40_000);
        expect(Math.abs(h)).toBeLessThanOrEqual(source.boundM);
      }
    }
    expect(createHeightSource('flat', 'plane').boundM).toBe(0);
  });
});

describe('Plan 059 crack probe counting', () => {
  function image(rows: string[]): Uint8Array {
    const values: Record<string, number> = { '.': 0, b: BACKSTOP_VALUE, '#': 255 };
    const out = new Uint8Array(rows.length * rows[0].length * 4);
    rows.join('').split('').forEach((ch, p) => { out[p * 4] = values[ch]; });
    return out;
  }

  it('counts a backstop pixel inside the surface and masks one on the outline', () => {
    const result = countCracks(image([
      '.....',
      '.###b',
      '.#b##',
      '.####',
    ]), 5, 4);
    expect(result.cracks).toBe(1);
    expect(result.masked).toBe(1);
    expect(result.background).toBe(8);
  });
});

describe('Plan 059 suite', () => {
  it('has unique case ids, controls that expect cracks, and plain settings', () => {
    const suite = LOD_SURFACE_TEST_HISTORY[1];
    const ids = suite.scenarios.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(suite.scenarios.filter((scenario) => crackExpectation(scenario.settings) === 'some').length).toBe(2);
    for (const scenario of suite.scenarios) expect(JSON.parse(JSON.stringify(scenario.settings))).toEqual(scenario.settings);
  });

  it('names every setting the page did not honour', () => {
    expect(settingsMismatches(DEFAULT_SETTINGS, DEFAULT_SETTINGS)).toEqual([]);
    expect(settingsMismatches({ ...DEFAULT_SETTINGS, patchCells: 32 }, DEFAULT_SETTINGS)).toEqual(['patchCells: expected 16, found 32']);
    expect(settingsMismatches(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, motion: 'zoom' }).length).toBe(1);
  });

  it('keeps every case of v1 in v2 and gives v2 still windows their full length in quick mode', () => {
    const [v1, v2] = LOD_SURFACE_TEST_HISTORY;
    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect(v2.scenarios.map((scenario) => scenario.id)).toEqual(v1.scenarios.map((scenario) => scenario.id));
    for (const scenario of v2.scenarios.filter((item) => item.settings.motion !== 'zoom')) expect(scenario.quickMs).toBeUndefined();
  });

  it('checks the state of a zoom case while the zoom runs, not after it ends', async () => {
    let zoom: number | undefined;
    let now = 0;
    let frames = 0;
    const host = {
      read: (): LodSurfaceTestSettings => ({ ...DEFAULT_SETTINGS, detailNoise: 0, ...(zoom !== undefined ? { motion: 'zoom' as const } : {}) }),
      setZoomProgress: (t: number | undefined) => { zoom = t; },
      renderedFrames: () => frames++,
      errors: () => '', resetErrors: () => undefined, backendIsWebGpu: () => true,
      frame: () => ({ stats: { leaves: 1, drawn: 1, splits: 0, forcedSplits: 0, newSplits: 0, merges: 0, visibleNewSplits: 0, visibleMerges: 0, unmet: 0, capHit: false, deepestLevel: 0 }, instances: 1, trianglesPerLeaf: 2, drawCalls: 1, rendererTriangles: 2, drawingBuffer: [1, 1] as const }),
      onRenderComplete: () => () => undefined,
      selectionSamples: () => [0.1], leafSamples: () => [1], levelChangeSamples: () => [0], levelChangeAllSamples: () => [0], resetSamples: () => undefined, setSweepTime: () => undefined,
      isSampling: () => false, startSampling: () => undefined, gpuSamplesSoFar: () => [],
      stopSampling: () => ({ frames: 100, cpuMedianMs: 1, cpuP95Ms: 1, wallMedianMs: 6, wallP95Ms: 6, gpuMedianMs: null, gpuSamples: 0, invalidReasons: [], verdict: 'ok' as const }),
      crackProbe: () => Promise.reject(new Error('no probe in a zoom case')),
      environment: () => ({}),
    } as unknown as LodSurfaceTestHost;
    spyOn(performance, 'now').and.callFake(() => now);
    const context = {
      mode: 'quick', repetition: 1, signal: new AbortController().signal,
      wait: (ms: number) => { now += ms; return Promise.resolve(); },
    } as unknown as TestContext;
    const scenario = LOD_SURFACE_TEST_HISTORY[4].scenarios.find((item) => item.id === 'zoom-sphere-600km') as TestScenario<LodSurfaceTestSettings>;
    zoom = 0;
    const observation = await createLodSurfaceTestAdapter(host).measure(scenario, context);
    expect(observation.checks?.find((check) => check.name === 'Scenario state applied as specified')?.passed).toBeTrue();
    expect(zoom).toBeUndefined();
  });

  it('probes five distinct positions on the biome traversal outside the timing window', async () => {
    let t: number | undefined = 0;
    let now = 0;
    let sampling = false;
    const probed: number[] = [];
    const host = {
      read: (): LodSurfaceTestSettings => ({ ...DEFAULT_SETTINGS, ...(t !== undefined ? { motion: 'biome-sweep' as const } : {}) }),
      setZoomProgress: (value: number | undefined) => { t = value; }, setSweepTime: () => undefined,
      renderedFrames: () => Math.floor(now / 16), errors: () => '', backendIsWebGpu: () => true,
      frame: () => ({ stats: { leaves: 1, drawn: 1, splits: 0, forcedSplits: 0, newSplits: 0, merges: 0, visibleNewSplits: 0, visibleMerges: 0, unmet: 0, capHit: false, deepestLevel: 0 }, instances: 1, trianglesPerLeaf: 2, drawCalls: 1, rendererTriangles: 2, drawingBuffer: [1, 1] as const }),
      onRenderComplete: () => () => undefined, selectionSamples: () => [0.1], leafSamples: () => [1], levelChangeSamples: () => [0], levelChangeAllSamples: () => [0], resetSamples: () => undefined,
      isSampling: () => sampling, startSampling: () => { sampling = true; }, gpuSamplesSoFar: () => [],
      stopSampling: () => { sampling = false; return { frames: 100, cpuMedianMs: 1, cpuP95Ms: 1, wallMedianMs: 6, wallP95Ms: 6, gpuMedianMs: null, gpuSamples: 0, invalidReasons: [], verdict: 'ok' as const }; },
      crackProbe: () => { expect(sampling).toBeFalse(); probed.push(t!); return Promise.resolve({ cracks: 0, masked: 0, surface: 10, background: 10, width: 4, height: 4 }); }, environment: () => ({}),
    } as unknown as LodSurfaceTestHost;
    spyOn(performance, 'now').and.callFake(() => now);
    const context = { mode: 'quick', repetition: 1, signal: new AbortController().signal, wait: (ms: number) => { now += ms; return Promise.resolve(); } } as unknown as TestContext;
    const scenario = { id: 'test', label: 'test', settings: { ...DEFAULT_SETTINGS, motion: 'biome-sweep' as const }, warmupMs: 0, durationMs: 100, quickMs: 100 };
    const result = await createLodSurfaceTestAdapter(host).measure(scenario, context);
    expect(probed).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(result.metrics?.find((metric) => metric.name === 'traversalCrackPixels')?.samples).toEqual([0, 0, 0, 0, 0]);
    expect(t).toBeUndefined();
  });

  it('runs a sweep case on the sweep clock, checks its state while it runs, probes after it and reports the level churn', async () => {
    let sweepAt: number | undefined;
    const times: number[] = [];
    let probes = 0;
    let now = 0;
    const host = {
      read: (): LodSurfaceTestSettings => ({ ...DEFAULT_SETTINGS, detailNoise: 0, ...(sweepAt !== undefined ? { motion: 'sweep' as const } : {}) }),
      setZoomProgress: () => undefined,
      setSweepTime: (t: number | undefined) => { sweepAt = t; if (t !== undefined) times.push(t); },
      renderedFrames: () => Math.floor(now / 16),
      errors: () => '', resetErrors: () => undefined, backendIsWebGpu: () => true,
      frame: () => ({ stats: { leaves: 1, drawn: 1, splits: 0, forcedSplits: 0, newSplits: 0, merges: 0, visibleNewSplits: 0, visibleMerges: 0, unmet: 0, capHit: false, deepestLevel: 0 }, instances: 1, trianglesPerLeaf: 2, drawCalls: 1, rendererTriangles: 2, drawingBuffer: [1, 1] as const }),
      onRenderComplete: () => () => undefined,
      selectionSamples: () => [0.1, 0.1, 0.1, 0.1], leafSamples: () => [1, 1, 1, 1], levelChangeSamples: () => [0, 6, 0, 2], levelChangeAllSamples: () => [0, 10, 0, 6], resetSamples: () => undefined,
      isSampling: () => false, startSampling: () => undefined, gpuSamplesSoFar: () => [],
      stopSampling: () => ({ frames: 100, cpuMedianMs: 1, cpuP95Ms: 1, wallMedianMs: 6, wallP95Ms: 6, gpuMedianMs: null, gpuSamples: 0, invalidReasons: [], verdict: 'ok' as const }),
      crackProbe: () => { probes++; return Promise.resolve({ cracks: 0, masked: 0, surface: 10, background: 10, width: 4, height: 4 }); },
      environment: () => ({}),
    } as unknown as LodSurfaceTestHost;
    spyOn(performance, 'now').and.callFake(() => now);
    const context = { mode: 'quick', repetition: 1, signal: new AbortController().signal, wait: (ms: number) => { now += ms; return Promise.resolve(); } } as unknown as TestContext;
    const scenario = LOD_SURFACE_TEST_HISTORY[4].scenarios.find((item) => item.id === 'sweep-sphere-600km-eye-2m') as TestScenario<LodSurfaceTestSettings>;
    sweepAt = 0;
    const observation = await createLodSurfaceTestAdapter(host).measure(scenario, context);
    expect(observation.checks?.find((check) => check.name === 'Scenario state applied as specified')?.passed).toBeTrue();
    expect(sweepAt).toBeUndefined();
    expect(probes).toBe(1);
    // Quick mode runs quickMs (4 s) of the sweep clock, in 16 ms steps from 0, the last clamped to the end.
    expect(times[0]).toBe(0);
    expect(times[times.length - 1]).toBeCloseTo(4, 6);
    expect(times.every((t, k) => k === 0 || t >= times[k - 1])).toBeTrue();
    const metric = (name: string) => observation.metrics?.find((item) => item.name === name);
    expect(metric('pixelsPerTriangleUpperBound')?.samples).toEqual([0.5]);
    expect(metric('drawCalls')?.samples).toEqual([1]);
    expect(metric('levelChanges')?.samples).toEqual([0, 6, 0, 2]);
    expect(metric('levelChangesPerSecond')?.samples[0]).toBeCloseTo(8 / 4.0, 1);
    expect(metric('levelChangesAll')?.samples[0]).toBeCloseTo(16 / 4.0, 1);
    expect(observation.validityIssues).not.toContain('Fewer than 60 rendered frames in the window');
  });
});

describe('Plan 059 suite versions and hysteresis', () => {
  const [v1, v2, v3, v4, v5, v6, t1, t2, t3] = LOD_SURFACE_TEST_HISTORY;
  const idsOf = (suite: typeof v1) => suite.scenarios.map((scenario) => scenario.id);

  it('lists the versions oldest first with the latest terrain suite last', () => {
    expect(LOD_SURFACE_TEST_HISTORY.map((suite) => `${suite.id}@${suite.version}`)).toEqual([
      'lod-surface-baseline@1', 'lod-surface-baseline@2', 'lod-surface-baseline@3', 'lod-surface-baseline@4', 'lod-surface-baseline@5', 'lod-surface-baseline@6', 'lod-surface-terrain@1', 'lod-surface-terrain@2', 'lod-surface-terrain@3', 'lod-surface-terrain@4', 'lod-surface-terrain@5', 'lod-surface-terrain@6', 'lod-surface-terrain@7', 'lod-surface-terrain@8',
    ]);
  });

  it('keeps v1, v2 and terrain v1 at the single threshold they were measured with, and gives the later versions the lab default', () => {
    for (const suite of [v1, v2, t1]) for (const scenario of suite.scenarios) expect(scenario.settings.hysteresis).withContext(`${suite.id}@${suite.version} ${scenario.id}`).toBe(0);
    expect(DEFAULT_SETTINGS.hysteresis).toBe(0.15);
    for (const suite of [v3, v4, v5, t2, t3]) {
      for (const scenario of suite.scenarios) {
        expect(scenario.settings.hysteresis).withContext(`${suite.id}@${suite.version} ${scenario.id}`).toBe(scenario.id.endsWith('-nohyst') ? 0 : 0.15);
      }
    }
  });

  it('keeps every earlier case id in v3 and terrain v2 and adds the sweep cases', () => {
    expect(idsOf(v3).slice(0, idsOf(v2).length)).toEqual(idsOf(v2));
    expect(idsOf(v3).slice(idsOf(v2).length)).toEqual(['sweep-sphere-600km-eye-2m', 'sweep-plane-100km-low-200m', 'sweep-plane-100km-low-200m-nohyst', 'sweep-sphere-600km-mid-5km', 'sweep-sphere-600km-mid-5km-nohyst']);
    for (const id of idsOf(v1)) expect(idsOf(v2)).toContain(id);
    expect(idsOf(t2).filter((id) => !idsOf(t1).includes(id))).toEqual(['sweep-cell-planet-sphere-10km-low-200m', 'sweep-cliff-plane-100km-low-200m']);
    expect(idsOf(t2).filter((id) => idsOf(t1).includes(id))).toEqual(idsOf(t1));
    expect(idsOf(v4)).toEqual(idsOf(v3));
    expect(idsOf(t3)).toEqual(idsOf(t2));
    expect(idsOf(v5)).toEqual(idsOf(v4));
    for (const suite of [v3, v4, v5, t2, t3]) {
      const ids = idsOf(suite);
      expect(new Set(ids).size).toBe(ids.length);
      for (const scenario of suite.scenarios.filter((item) => item.id.startsWith('sweep-'))) {
        expect(scenario.settings.motion).toBe('sweep');
        expect(scenario.durationMs).toBe(8000);
        expect(scenario.quickMs).toBe(4000);
      }
    }
  });

  it('runs baseline v5 and terrain v7 at the 16-cell default and keeps the earlier versions at 32 cells', () => {
    expect(DEFAULT_SETTINGS.patchCells).toBe(16);
    const t7 = LOD_SURFACE_TEST_HISTORY.find((suite) => suite.id === 'lod-surface-terrain' && suite.version === 7)!;
    const t6 = LOD_SURFACE_TEST_HISTORY.find((suite) => suite.id === 'lod-surface-terrain' && suite.version === 6)!;
    // Cases that name their own cell count keep it: the 16 and 64 cell baseline cases and the cells A/B.
    const named = (id: string) => /cells/.test(id);
    for (const scenario of [...v5.scenarios, ...t7.scenarios].filter((item) => !named(item.id))) expect(scenario.settings.patchCells).withContext(scenario.id).toBe(16);
    for (const scenario of [...v4.scenarios, ...t6.scenarios].filter((item) => !named(item.id))) expect(scenario.settings.patchCells).withContext(scenario.id).toBe(32);
    expect(t7.scenarios.map((scenario) => scenario.id)).toEqual(t6.scenarios.map((scenario) => scenario.id));
  });

  it('adds the six turn cases in baseline v6 and keeps v5 as it was', () => {
    expect(idsOf(v6).slice(0, idsOf(v5).length)).toEqual(idsOf(v5));
    expect(v6.scenarios.slice(0, v5.scenarios.length)).toEqual(v5.scenarios);
    const turns = v6.scenarios.slice(v5.scenarios.length);
    expect(turns.map((scenario) => scenario.id)).toEqual([
      'turn-plane-100km-low-200m', 'turn-plane-100km-low-200m-cap16k', 'turn-plane-100km-low-200m-nocull',
      'turn-sphere-600km-mid-5km', 'turn-sphere-600km-mid-5km-cap16k', 'turn-sphere-600km-mid-5km-nocull',
    ]);
    expect(new Set(idsOf(v6)).size).toBe(idsOf(v6).length);
    for (const scenario of turns) {
      expect(scenario.settings.motion).withContext(scenario.id).toBe('turn');
      expect(scenario.settings.detailNoise).toBe(0);
      expect(scenario.settings.patchCells).toBe(16);
      expect(scenario.settings.hysteresis).toBe(0.15);
      expect(scenario.durationMs).toBe(8000);
      expect(scenario.quickMs).toBe(4000);
    }
  });

  it('runs the turn variants as the default case with only the leaf cap or the culling changed', () => {
    const turns = v6.scenarios.filter((scenario) => scenario.id.startsWith('turn-'));
    for (let k = 0; k < turns.length; k += 3) {
      const [base, cap, nocull] = turns.slice(k, k + 3);
      expect(base.settings.leafCap).toBe(1024);
      expect(base.settings.cull).toBeTrue();
      expect(cap.settings).toEqual({ ...base.settings, leafCap: TURN_UNCAPPED_LEAVES });
      expect(nocull.settings).toEqual({ ...base.settings, cull: false });
    }
    expect(turns.map((scenario) => `${scenario.settings.domain}|${scenario.settings.pose}`)).toEqual([
      ...Array(3).fill('plane-100km|low-200m'), ...Array(3).fill('sphere-600km|mid-5km'),
    ]);
    expect(TURN_UNCAPPED_LEAVES).toBeGreaterThan(4096);
  });

  it('runs a turn case on the turn clock, checks its state while it runs and reports the level churn', async () => {
    let turnAt: number | undefined;
    const times: number[] = [];
    let now = 0;
    const host = {
      read: (): LodSurfaceTestSettings => ({ ...DEFAULT_SETTINGS, detailNoise: 0, ...(turnAt !== undefined ? { motion: 'turn' as const } : {}) }),
      setZoomProgress: () => undefined, setSweepTime: () => { throw new Error('a turn must not use the sweep clock'); },
      setTurnTime: (t: number | undefined) => { turnAt = t; if (t !== undefined) times.push(t); },
      renderedFrames: () => Math.floor(now / 16),
      errors: () => '', resetErrors: () => undefined, backendIsWebGpu: () => true,
      frame: () => ({ stats: { leaves: 1, drawn: 1, splits: 0, forcedSplits: 0, newSplits: 0, merges: 0, visibleNewSplits: 0, visibleMerges: 0, unmet: 0, capHit: false, deepestLevel: 0 }, instances: 1, trianglesPerLeaf: 2, drawCalls: 1, rendererTriangles: 2, drawingBuffer: [1, 1] as const }),
      onRenderComplete: () => () => undefined,
      selectionSamples: () => [0.1, 0.1], leafSamples: () => [1, 1], levelChangeSamples: () => [0, 4], levelChangeAllSamples: () => [0, 8], resetSamples: () => undefined,
      isSampling: () => false, startSampling: () => undefined, gpuSamplesSoFar: () => [],
      stopSampling: () => ({ frames: 100, cpuMedianMs: 1, cpuP95Ms: 1, wallMedianMs: 6, wallP95Ms: 6, gpuMedianMs: null, gpuSamples: 0, invalidReasons: [], verdict: 'ok' as const }),
      crackProbe: () => Promise.resolve({ cracks: 0, masked: 0, surface: 10, background: 10, width: 4, height: 4 }),
      environment: () => ({}),
    } as unknown as LodSurfaceTestHost;
    spyOn(performance, 'now').and.callFake(() => now);
    const context = { mode: 'quick', repetition: 1, signal: new AbortController().signal, wait: (ms: number) => { now += ms; return Promise.resolve(); } } as unknown as TestContext;
    const scenario = v6.scenarios.find((item) => item.id === 'turn-plane-100km-low-200m') as TestScenario<LodSurfaceTestSettings>;
    turnAt = 0;
    const observation = await createLodSurfaceTestAdapter(host).measure(scenario, context);
    expect(observation.checks?.find((check) => check.name === 'Scenario state applied as specified')?.passed).toBeTrue();
    expect(turnAt).toBeUndefined();
    expect(times[0]).toBe(0);
    expect(times[times.length - 1]).toBeCloseTo(4, 6);
    expect(observation.metrics?.find((item) => item.name === 'levelChanges')?.samples).toEqual([0, 4]);
    expect(observation.metrics?.find((item) => item.name === 'levelChangesPerSecond')?.samples[0]).toBeCloseTo(4 / 4.0, 1);
  });

  it('runs the A/B partner of a sweep with the same settings but the hysteresis', () => {
    const a = v3.scenarios.find((scenario) => scenario.id === 'sweep-plane-100km-low-200m')!;
    const b = v3.scenarios.find((scenario) => scenario.id === 'sweep-plane-100km-low-200m-nohyst')!;
    expect({ ...b.settings, hysteresis: a.settings.hysteresis }).toEqual(a.settings);
    expect(b.settings.hysteresis).toBe(0);
  });

  it('names a hysteresis or sweep the page did not honour', () => {
    expect(settingsMismatches({ ...DEFAULT_SETTINGS, hysteresis: 0 }, DEFAULT_SETTINGS)).toEqual(['hysteresis: expected 0.15, found 0']);
    expect(settingsMismatches(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, motion: 'sweep' }).length).toBe(1);
    expect(settingsMismatches(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, motion: 'turn' }).length).toBe(1);
  });
});

describe('Plan 059 selector with per-node height ranges', () => {
  const POSE_IDS = ['eye-2m', 'low-200m', 'mid-5km', 'horizon', 'orbit'] as const;
  const sphere10 = domainPreset('sphere-10km');

  function noiseSource(domain: LodDomain, k = 6) {
    const layout: BakeLayout = { kind: domain.kind, warp: domain.warp, sizeM: domain.sizeM, k };
    return createTextureHeightSource('noise', bakeHeights(layout, noiseSampler(layout)));
  }

  for (const [label, domain] of [['plane', plane], ['sphere 10 km', sphere10], ['sphere 600 km', sphere600]] as const) {
    it(`keeps a whole, 2:1-balanced tree with consistent masks (${label})`, () => {
      const source = noiseSource(domain);
      for (const cull of [false, true]) {
        const selector = new LodSelector(settingsFor(domain, { heightBoundM: source.boundM, heightRanges: source, cull, leafCap: 400 }));
        for (const pose of POSE_IDS) {
          selector.select(viewFor(domain, pose));
          expect(balanceIssues(selector, domain)).withContext(`${pose} cull ${cull}`).toEqual([]);
          expect(coveredArea(selector)).withContext(`${pose} cull ${cull}`).toBeCloseTo(domain.kind === 'plane' ? 1 : 6, 9);
        }
      }
      source.dispose();
    });

    it(`picks exactly the plain reference's leaves when every range is the global bound (${label})`, () => {
      const bound = 80;
      const stub: NodeHeightRanges = { nodeRange: (_root, _level, _i, _j, out) => { out[0] = -bound; out[1] = bound; } };
      const base = settingsFor(domain, { heightBoundM: bound, leafCap: 300 });
      const selector = new LodSelector({ ...base, heightRanges: stub }, 2);
      const reference = new ReferenceSelector(base);
      for (const pose of POSE_IDS) {
        const view = viewOfCamera(domain, poseView(pose, domain));
        selector.select(view);
        reference.select(view);
        expect(leavesOf(selector)).withContext(pose).toEqual(reference.leaves);
        expect(statsOf(selector)).withContext(pose).toEqual(reference.stats);
      }
    });
  }

  it('bounds every displaced vertex of every selected leaf by the node sphere (centre moved to mid-range, radius widened)', () => {
    const PATCH = 32;
    for (const domain of [sphere10, plane]) {
      const source = noiseSource(domain);
      const selector = new LodSelector(settingsFor(domain, { heightBoundM: source.boundM, heightRanges: source, cull: false, leafCap: 300 }));
      const range: [number, number] = [0, 0];
      const position: Vec3 = [0, 0, 0];
      const normal: Vec3 = [0, 0, 0];
      const lattice = leafLattice(0, 0, 0, 0, PATCH, maxLevelFor(PATCH));
      for (const pose of POSE_IDS) {
        selector.select(viewFor(domain, pose));
        for (let k = 0; k < selector.stats.leaves; k += 3) {
          const node = selector.leaves[k];
          const level = selector.level[node];
          source.nodeRange(selector.root[node], level, selector.i[node], selector.j[node], range);
          const mid = (range[0] + range[1]) / 2;
          const centre = [0, 1, 2].map((a) => selector.center[node * 3 + a] + selector.normal[node * 3 + a] * mid);
          leafLattice(selector.root[node], level, selector.i[node], selector.j[node], PATCH, maxLevelFor(PATCH), lattice);
          for (let gy = 0; gy <= PATCH; gy += 4) {
            for (let gx = 0; gx <= PATCH; gx += 4) {
              const [u, v] = gridLattice(lattice, gx, gy);
              domainPoint(domain, lattice.root, u / 2 ** 24, v / 2 ** 24, position, normal);
              const h = source.heightAtLattice(lattice.root, u, v);
              const distance = Math.hypot(...[0, 1, 2].map((a) => position[a] + normal[a] * h - centre[a]));
              expect(distance).withContext(`${pose} node ${node} vertex ${gx},${gy}`).toBeLessThanOrEqual(selector.radius[node] * (1 + 1e-9) + 1e-6);
            }
          }
        }
      }
      source.dispose();
    }
  });

  it('gives deep nodes tighter spheres than the global bound would', () => {
    const source = noiseSource(sphere10, 7);
    const ranged = new LodSelector(settingsFor(sphere10, { heightBoundM: source.boundM, heightRanges: source, cull: false, leafCap: 400 }));
    const global = new LodSelector(settingsFor(sphere10, { heightBoundM: source.boundM, cull: false, leafCap: 400 }));
    const view = viewFor(sphere10, 'low-200m');
    ranged.select(view);
    global.select(view);
    let tighter = 0;
    let deep = 0;
    for (let k = 0; k < ranged.stats.leaves; k++) {
      const node = ranged.leaves[k];
      if (ranged.level[node] < 7) continue;
      deep++;
      // Same cell, same order of nodes only if the trees match, so compare the radius of the same (root, level, i, j) by formula.
      const range: [number, number] = [0, 0];
      source.nodeRange(ranged.root[node], ranged.level[node], ranged.i[node], ranged.j[node], range);
      if (range[1] - range[0] < 2 * source.boundM * 0.5) tighter++;
    }
    expect(deep).toBeGreaterThan(0);
    expect(tighter).toBe(deep);
    expect(ranged.stats.leaves).toBeGreaterThan(0);
    expect(global.stats.leaves).toBeGreaterThan(0);
    source.dispose();
  });
});
