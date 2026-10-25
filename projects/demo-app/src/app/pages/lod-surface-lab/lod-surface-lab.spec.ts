import { poseView, resolveCamera, frustumNormals } from './lod-camera';
import { BACKSTOP_VALUE, countCracks } from './lod-crack-probe';
import { EDGE_STEP, FACE_FRAMES, cubePoint, domainPoint, domainPreset, neighbourCell, warpCoordinate, type LodDomain, type NeighbourCell, type Vec3 } from './lod-domain';
import { createHeightSource } from './lod-height';
import { createLodSurfaceMesh } from './lod-surface-mesh';
import { anchorFor, cubeLattice, foldedGrid, gridLattice, latticeSteps, leafLattice, planeVertexF32, smallSinF32, sphereVertexF32 } from './lod-lattice';
import { CAP_SLACK, LodSelector, maxLevelFor, type SelectorSettings, type SelectorView } from './lod-selector';
import { createLodSurfaceTestAdapter, settingsMismatches, type LodSurfaceTestHost } from './lod-surface-test-adapter';
import type { LodSurfaceTestSettings } from './lod-surface-tests';
import type { TestContext, TestScenario } from 'triangular-engine/testing';
import { DEFAULT_SETTINGS, LOD_SURFACE_TEST_HISTORY, crackExpectation } from './lod-surface-tests';

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
    const suite = LOD_SURFACE_TEST_HISTORY[LOD_SURFACE_TEST_HISTORY.length - 1];
    const ids = suite.scenarios.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(suite.scenarios.filter((scenario) => crackExpectation(scenario.settings) === 'some').length).toBe(2);
    for (const scenario of suite.scenarios) expect(JSON.parse(JSON.stringify(scenario.settings))).toEqual(scenario.settings);
  });

  it('names every setting the page did not honour', () => {
    expect(settingsMismatches(DEFAULT_SETTINGS, DEFAULT_SETTINGS)).toEqual([]);
    expect(settingsMismatches({ ...DEFAULT_SETTINGS, patchCells: 16 }, DEFAULT_SETTINGS)).toEqual(['patchCells: expected 32, found 16']);
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
    let frames = 0;
    const host = {
      read: (): LodSurfaceTestSettings => ({ ...DEFAULT_SETTINGS, ...(zoom !== undefined ? { motion: 'zoom' as const } : {}) }),
      setZoomProgress: (t: number | undefined) => { zoom = t; },
      renderedFrames: () => frames++,
      errors: () => '', resetErrors: () => undefined, backendIsWebGpu: () => true,
      frame: () => ({ stats: { leaves: 1, drawn: 1, splits: 0, forcedSplits: 0, unmet: 0, capHit: false, deepestLevel: 0 }, instances: 1, trianglesPerLeaf: 2, drawCalls: 1, rendererTriangles: 2, drawingBuffer: [1, 1] as const }),
      onRenderComplete: () => () => undefined,
      selectionSamples: () => [0.1], leafSamples: () => [1], resetSamples: () => undefined,
      isSampling: () => false, startSampling: () => undefined, gpuSamplesSoFar: () => [],
      stopSampling: () => ({ frames: 100, cpuMedianMs: 1, cpuP95Ms: 1, wallMedianMs: 6, wallP95Ms: 6, gpuMedianMs: null, gpuSamples: 0, invalidReasons: [], verdict: 'ok' as const }),
      crackProbe: () => Promise.reject(new Error('no probe in a zoom case')),
      environment: () => ({}),
    } as unknown as LodSurfaceTestHost;
    let now = 0;
    spyOn(performance, 'now').and.callFake(() => now);
    const context = {
      mode: 'quick', repetition: 1, signal: new AbortController().signal,
      wait: (ms: number) => { now += ms; return Promise.resolve(); },
    } as unknown as TestContext;
    const scenario = LOD_SURFACE_TEST_HISTORY[1].scenarios.find((item) => item.id === 'zoom-sphere-600km') as TestScenario<LodSurfaceTestSettings>;
    zoom = 0;
    const observation = await createLodSurfaceTestAdapter(host).measure(scenario, context);
    expect(observation.checks?.find((check) => check.name === 'Scenario state applied as specified')?.passed).toBeTrue();
    expect(zoom).toBeUndefined();
  });
});
