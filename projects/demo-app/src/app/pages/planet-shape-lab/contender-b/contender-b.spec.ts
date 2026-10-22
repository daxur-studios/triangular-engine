import { COLUMN_STRIDE } from './column-scan-gpu';
import {
  LATTICE, LEAF_CELLS, beyondEdge, children, faceCoordinates, faceDirection, faceOf, latticeDirection, latticeKey, leafAt, leafRange,
  type Vec3,
} from './cube-sphere';
import { selectLeaves, type SelectedLeaf } from './leaf-select';
import { LEAF_VERTICES, buildShellMesh, shellColumns } from './shell-mesh';
import { buildZoneMesh } from './zone-mesh';

const R = 600_000;

/** A whole-sphere selection: the camera inside the planet sees no horizon, and no view culls, so every leaf is drawn. */
function wholeSphere(pixelAngle: number): ReturnType<typeof selectLeaves> {
  return selectLeaves({ radiusM: R, camera: [0.2 * R, 0.3 * R, 0.5 * R], pixelAngle, cellPixels: 4, band: { bottomM: -1000, topM: 1000 } });
}

/** A scan with one crossing per column at a height from the direction, plus a per-leaf offset only sharing can hide. */
function fakeScan(leaves: readonly SelectedLeaf[], perLeafOffset: number): Float32Array {
  const columns = shellColumns(leaves, { radiusM: R, origin: [0, 0, 0], band: { bottomM: -1000, topM: 1000 } });
  const scan = new Float32Array(columns.count * COLUMN_STRIDE);
  for (let c = 0; c < columns.count; c++) {
    const [x, y, z] = columns.direction.subarray(c * 4, c * 4 + 3);
    const leaf = Math.floor(c / (LEAF_VERTICES * LEAF_VERTICES));
    scan[c * COLUMN_STRIDE] = 1;
    scan[c * COLUMN_STRIDE + 1] = 300 * Math.sin(5 * x) * Math.cos(4 * y) + 100 * z + leaf * perLeafOffset;
  }
  return scan;
}

describe('contender B cube-sphere', () => {
  it('maps face coordinates to directions and back', () => {
    for (let face = 0; face < 6; face++) {
      for (const [s, t] of [[0, 0], [0.5, -0.25], [-0.99, 0.7], [0.3, 0.999]]) {
        const d = faceDirection(face, s, t);
        expect(Math.hypot(...d)).toBeCloseTo(1, 12);
        const back = faceCoordinates(d);
        expect(back.face).toBe(face);
        expect(back.s).toBeCloseTo(s, 12);
        expect(back.t).toBeCloseTo(t, 12);
      }
    }
  });

  it('gives a point on a cube edge the same key and the same direction from both faces', () => {
    // +X (u = y, v = z) and +Y (u = z, v = x) share the edge x = y = 1.
    for (const q of [0, 12345, LATTICE / 2, LATTICE - 7, LATTICE]) {
      expect(latticeKey(0, LATTICE, q)).toBe(latticeKey(2, q, LATTICE));
      const a = latticeDirection(0, LATTICE, q);
      const b = latticeDirection(2, q, LATTICE);
      expect(a[0]).toBe(b[0]);
      expect(a[1]).toBe(b[1]);
      expect(a[2]).toBe(b[2]);
    }
    // A cube corner, from all three faces that meet there (+X, +Y, +Z).
    const corner = latticeKey(0, LATTICE, LATTICE);
    expect(latticeKey(2, LATTICE, LATTICE)).toBe(corner);
    expect(latticeKey(4, LATTICE, LATTICE)).toBe(corner);
  });

  it('finds the leaf holding a direction, its children inside it, and the next face across a cube edge', () => {
    const d = faceDirection(3, 0.31, -0.62);
    const leaf = leafAt(d, 5);
    const [s0, s1] = leafRange(5, leaf.i);
    const [t0, t1] = leafRange(5, leaf.j);
    expect(leaf.face).toBe(3);
    expect(0.31).toBeGreaterThanOrEqual(s0);
    expect(0.31).toBeLessThan(s1);
    expect(-0.62).toBeGreaterThanOrEqual(t0);
    expect(-0.62).toBeLessThan(t1);
    const child = leafAt(d, 6);
    expect(children(leaf).some(({ i, j }) => i === child.i && j === child.j)).toBeTrue();
    // The east edge of face 0's east-most leaf is face 0's s = 1 edge: beyond it lies another face.
    const east = beyondEdge({ face: 0, level: 3, i: 7, j: 3 }, 1, 2);
    for (const point of east) expect(faceOf(point)).not.toBe(0);
  });
});

describe('contender B leaf selection', () => {
  it('covers the sphere once, balanced to one level between edge neighbours', () => {
    const selection = wholeSphere(0.004);
    const leaves = [...selection.leaves.values()];
    expect(selection.drawn.length).toBe(leaves.length);
    // Face area in face coordinates is 4; the leaves tile all six faces.
    const area = leaves.reduce((sum, leaf) => sum + (2 / 2 ** leaf.key.level) ** 2, 0);
    expect(area).toBeCloseTo(24, 9);
    const levels = new Set(leaves.map((leaf) => leaf.key.level));
    expect(levels.size).toBeGreaterThan(2);
    const holding = (point: Vec3) => {
      for (let level = 0; level < 20; level++) {
        const found = selection.leaves.get((({ face, i, j }) => `${face}/${level}/${i}/${j}`)(leafAt(point, level)));
        if (found) return found;
      }
      throw new Error('uncovered point');
    };
    for (const leaf of leaves) {
      for (const edge of [0, 1, 2, 3] as const) {
        const neighbours = beyondEdge(leaf.key, edge, 4).map(holding);
        for (const neighbour of neighbours) expect(Math.abs(neighbour.key.level - leaf.key.level)).toBeLessThanOrEqual(1);
        const coarser = neighbours.some((neighbour) => neighbour.key.level < leaf.key.level);
        expect(((leaf.coarserEdges >> edge) & 1) === 1).withContext(`${leaf.id} edge ${edge}`).toBe(coarser);
      }
    }
  });

  it('splits deeper under the camera than far from it, and culls what is behind the horizon or out of view', () => {
    const camera: Vec3 = [0, 0, R + 2000];
    const selection = selectLeaves({
      // Looking down 73 degrees, so the ground under the camera is in view.
      radiusM: R, camera, forward: [0.287348, 0, -0.957826], up: [0.957826, 0, 0.287348], fovDeg: 60, aspect: 16 / 9, pixelAngle: 0.0008, cellPixels: 6,
      band: { bottomM: -500, topM: 500 },
    });
    const under = selection.drawn.find(({ key }) => {
      const holding = leafAt([0, 0, 1], key.level);
      return holding.face === key.face && holding.i === key.i && holding.j === key.j;
    });
    const deepest = Math.max(...selection.drawn.map((leaf) => leaf.key.level));
    expect(under?.key.level).toBe(deepest);
    expect(deepest).toBeGreaterThan(8);
    // The far side of the planet and the sky behind the camera are culled.
    expect(selection.drawn.some((leaf) => leaf.key.face === 5)).toBeFalse();
    expect(selection.leaves.size).toBeGreaterThan(selection.drawn.length);
  });
});

describe('contender B shell mesh', () => {
  it('is watertight over the whole sphere: every edge shared by exactly two triangles, wound opposite ways', () => {
    const selection = wholeSphere(0.004);
    const leaves = selection.drawn;
    const mesh = buildShellMesh(leaves, fakeScan(leaves, 0.5), { radiusM: R, origin: [0, 0, 0], band: { bottomM: -1000, topM: 1000 } });
    // Vertices are welded by exact position: shared vertices must be bit-identical.
    const id = new Map<string, number>();
    const vertex = (v: number) => {
      const key = `${mesh.positions[v * 3]},${mesh.positions[v * 3 + 1]},${mesh.positions[v * 3 + 2]}`;
      let found = id.get(key);
      if (found === undefined) id.set(key, (found = id.size));
      return found;
    };
    const directed = new Map<string, number>();
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const [a, b, c] = [vertex(mesh.indices[t]), vertex(mesh.indices[t + 1]), vertex(mesh.indices[t + 2])];
      expect(a !== b && b !== c && a !== c).toBeTrue();
      for (const [p, q] of [[a, b], [b, c], [c, a]]) directed.set(`${p}>${q}`, (directed.get(`${p}>${q}`) ?? 0) + 1);
    }
    let open = 0;
    let doubled = 0;
    for (const [edge, count] of directed) {
      const [p, q] = edge.split('>');
      if (count > 1) doubled++;
      if (!directed.has(`${q}>${p}`)) open++;
    }
    expect(doubled).toBe(0);
    expect(open).toBe(0);
    // Euler characteristic of a closed sphere.
    const edges = directed.size / 2;
    expect(id.size - edges + mesh.indices.length / 3).toBe(2);
  });

  it('winds every triangle counter-clockwise seen from outside', () => {
    const selection = wholeSphere(0.004);
    const mesh = buildShellMesh(selection.drawn, fakeScan(selection.drawn, 0), { radiusM: R, origin: [0, 0, 0], band: { bottomM: -1000, topM: 1000 } });
    const p = mesh.positions;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const [a, b, c] = [mesh.indices[t] * 3, mesh.indices[t + 1] * 3, mesh.indices[t + 2] * 3];
      const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
      const v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      expect(n[0] * p[a] + n[1] * p[a + 1] + n[2] * p[a + 2]).toBeGreaterThan(0);
    }
  });

  it('closes with the near zone: shell, zone (a cave that overhangs) and seam share every edge', () => {
    // A zone of 6 x 5 leaves on face 4 (+Z), the rest of the sphere as shell around it at various levels.
    const pinned = { face: 4, level: 4, i0: 5, i1: 10, j0: 6, j1: 10 } as const;
    const selection = selectLeaves({
      radiusM: R, camera: [0.1 * R, 0.1 * R, 0.6 * R], pixelAngle: 0.004, cellPixels: 4, band: { bottomM: -20_000, topM: 20_000 }, pinned,
    });
    expect(selection.pinnedConflicts).toBe(0);
    const inZone = (leaf: SelectedLeaf) => leaf.key.face === 4 && leaf.key.level === 4 && leaf.key.i >= 5 && leaf.key.i <= 10
      && leaf.key.j >= 6 && leaf.key.j <= 10;
    const zoneLeaves = selection.drawn.filter(inZone);
    expect(zoneLeaves.length).toBe(30);
    // Ground with a cave: inside a cap around the zone's middle, rock from the surface down 2 km, air for up to 6 km,
    // rock again below (three crossings); a different offset per scanned leaf, which only shared heights can hide.
    const middle = faceDirection(4, ((7.5 + 0.5) / 16) * 2 - 1, ((8 + 0.5) / 16) * 2 - 1);
    const scanOfLeaves = (leaves: readonly SelectedLeaf[], offset: number) => {
      const columns = shellColumns(leaves, { radiusM: R, origin: [0, 0, 0], band: { bottomM: -20_000, topM: 20_000 } });
      const scan = new Float32Array(columns.count * COLUMN_STRIDE);
      for (let c = 0; c < columns.count; c++) {
        const [x, y, z] = columns.direction.subarray(c * 4, c * 4 + 3);
        const h = 5000 * Math.sin(5 * x) * Math.cos(4 * y) + 2000 * z + Math.floor(c / (LEAF_VERTICES * LEAF_VERTICES)) * offset;
        const angle = Math.acos(Math.min(1, x * middle[0] + y * middle[1] + z * middle[2]));
        const t = 6000 * (1 - (angle / 0.06) ** 2);
        const s = c * COLUMN_STRIDE;
        if (t > 300) {
          scan.set([3, h, h - 2000, h - 2000 - t], s);
        } else {
          scan.set([1, h], s);
        }
      }
      return scan;
    };
    const perLeaf = LEAF_VERTICES * LEAF_VERTICES * COLUMN_STRIDE;
    const zoneScan = scanOfLeaves(zoneLeaves, 0.25);
    const zone = buildZoneMesh({
      radiusM: R, origin: [0, 0, 0], zone: pinned,
      scanOf: (i, j) => {
        const l = zoneLeaves.findIndex((leaf) => leaf.key.i === i && leaf.key.j === j);
        return zoneScan.subarray(l * perLeaf, (l + 1) * perLeaf);
      },
      outsideLevel: (side, x, y) => {
        const columns = LATTICE / 2 ** (19 - 4);
        const sx = side === 0 ? x - 0.5 : side === 1 ? x + 0.5 : x + 0.5;
        const sy = side === 2 ? y - 0.5 : side === 3 ? y + 0.5 : y + 0.5;
        return selection.holding(faceDirection(4, (2 * sx) / columns - 1, (2 * sy) / columns - 1))!.key.level;
      },
    });
    expect(zone.overhangColumns).toBeGreaterThan(100);
    const shellLeaves = selection.drawn.filter((leaf) => !inZone(leaf));
    const shell = buildShellMesh(shellLeaves, scanOfLeaves(shellLeaves, 0.5), {
      radiusM: R, origin: [0, 0, 0], band: { bottomM: -20_000, topM: 20_000 }, fixedHeights: zone.boundaryHeights,
    });
    // Weld by exact position and check that every directed edge has its reverse once.
    const id = new Map<string, number>();
    const directed = new Map<string, number>();
    let degenerate = 0;
    for (const mesh of [shell, zone]) {
      const vertex = (v: number) => {
        const key = `${mesh.positions[v * 3]},${mesh.positions[v * 3 + 1]},${mesh.positions[v * 3 + 2]}`;
        let found = id.get(key);
        if (found === undefined) id.set(key, (found = id.size));
        return found;
      };
      for (let t = 0; t < mesh.indices.length; t += 3) {
        const [a, b, c] = [vertex(mesh.indices[t]), vertex(mesh.indices[t + 1]), vertex(mesh.indices[t + 2])];
        if (a === b || b === c || a === c) {
          degenerate++;
          continue;
        }
        for (const [p, q] of [[a, b], [b, c], [c, a]]) directed.set(`${p}>${q}`, (directed.get(`${p}>${q}`) ?? 0) + 1);
      }
    }
    let open = 0;
    let doubled = 0;
    for (const [edge, count] of directed) {
      const [p, q] = edge.split('>');
      if (count > 1) doubled++;
      if (!directed.has(`${q}>${p}`)) open++;
    }
    expect(degenerate).toBe(0);
    expect(doubled).toBe(0);
    expect(open).toBe(0);
  });

  it('counts leaves whose columns cross the ground more than once', () => {
    const leaves = wholeSphere(0.02).drawn;
    const scan = fakeScan(leaves, 0);
    scan[COLUMN_STRIDE * (LEAF_VERTICES * LEAF_VERTICES + 3)] = 3;
    const mesh = buildShellMesh(leaves, scan, { radiusM: R, origin: [0, 0, 0], band: { bottomM: -1000, topM: 1000 } });
    expect(mesh.overhangLeaves).toBe(1);
    expect(mesh.mostCrossings).toBe(3);
    expect(LEAF_CELLS).toBe(32);
  });
});
