import { poseView, resolveCamera, frustumNormals } from './lod-camera';
import { BACKSTOP_VALUE, countCracks } from './lod-crack-probe';
import { EDGE_STEP, cubePoint, domainPoint, domainPreset, neighbourCell, warpCoordinate, type LodDomain, type NeighbourCell, type Vec3 } from './lod-domain';
import { createHeightSource } from './lod-height';
import { CAP_SLACK, LodSelector, maxLevelFor, type SelectorSettings, type SelectorView } from './lod-selector';
import { settingsMismatches } from './lod-surface-test-adapter';
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
});
