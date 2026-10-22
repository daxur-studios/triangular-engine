import { CROSSING_SLOTS, COLUMN_STRIDE } from './column-scan-gpu';
import { LEAF_CELLS, latticeCoordinate, latticeDirection, latticeKey, type Vec3 } from './cube-sphere';
import { LEAF_VERTICES } from './shell-mesh';

/**
 * Plan 055 contender B, stage 2 of the seam spike: the near volume zone. A rectangle of leaves around the camera, all at
 * one level on one cube face, meshed as one grid with surface nets, so ground that overhangs (a column crossing the
 * surface more than once) is drawn as it is. Outside the zone the height shell draws the outermost ground.
 *
 * The zone needs no 3D sampling: every lattice column's scan (`column-scan-gpu.ts`) lists where the field changes sign
 * along it, so the sign at any altitude is known exactly, the crossings on radial grid edges are the scanned roots,
 * and a crossing on a horizontal edge (between two columns at one altitude) is placed by the signed vertical distance
 * to each column's nearest crossing. Radial levels are a global lattice (`k * cellM`), cells as tall as wide.
 *
 * The seam with the shell: the zone's boundary columns keep only their outermost crossing (as the shell does), so the
 * boundary faces are single valued and their contour runs from shell vertex to shell vertex (the same heights, by
 * lattice key). Surface-nets quads that would need cells outside the zone are replaced by a strip from the boundary
 * cells' vertices to that contour, and a fan from each shell edge to the contour points between its two vertices closes
 * what is left, so the zone and the shell share every boundary vertex.
 *
 * Work is done in zone coordinates: x and y in columns (global column index at the zone's level), r the altitude.
 */

export interface ZoneRect {
  readonly face: number;
  readonly level: number;
  /** Inclusive leaf ranges. */
  readonly i0: number;
  readonly i1: number;
  readonly j0: number;
  readonly j1: number;
}

/** Sides of the zone, as `Edge` in `cube-sphere.ts`: 0 west (x = A0), 1 east, 2 south (y = B0), 3 north. */
export type ZoneSide = 0 | 1 | 2 | 3;

export interface ZoneBuildParams {
  readonly radiusM: number;
  readonly origin: Readonly<Vec3>;
  readonly zone: ZoneRect;
  /** Scan of a zone leaf (`LEAF_VERTICES^2` columns, `COLUMN_STRIDE` each), by leaf (i, j). */
  readonly scanOf: (i: number, j: number) => Float32Array;
  /**
   * Level of the shell leaf just outside the zone at boundary column (x, y) on `side`: the shell's edge vertices are
   * every column for the zone's level or finer, every even column for one coarser.
   */
  readonly outsideLevel: (side: ZoneSide, x: number, y: number) => number;
  /** Whether zone leaf (i, j) is in view; cells of leaves out of view are not meshed (default: all are). */
  readonly visible?: (i: number, j: number) => boolean;
}

export interface ZoneMesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  /** Outermost ground of the boundary columns, by lattice key: the shell's edge vertices must use these. */
  readonly boundaryHeights: ReadonlyMap<string, number>;
  readonly cells: number;
  readonly overhangColumns: number;
}

export function buildZoneMesh(params: ZoneBuildParams): ZoneMesh {
  const { radiusM: R, origin, zone } = params;
  const { face, level } = zone;
  const A0 = zone.i0 * LEAF_CELLS;
  const A1 = (zone.i1 + 1) * LEAF_CELLS;
  const B0 = zone.j0 * LEAF_CELLS;
  const B1 = (zone.j1 + 1) * LEAF_CELLS;
  const nA = A1 - A0 + 1;
  const nB = B1 - B0 + 1;
  const cellM = (R * (Math.PI / 2)) / 2 ** level / LEAF_CELLS;
  const onBoundary = (x: number, y: number) => x === A0 || x === A1 || y === B0 || y === B1;

  // Columns, from the leaves' scans (an edge column is shared: the first leaf to list it wins): per column its crossing
  // count, its crossings top down (`CROSSING_SLOTS` each), and whether a column without crossings is all rock.
  const total = nA * nB;
  const counts = new Uint8Array(total);
  const allRock = new Uint8Array(total);
  const filled = new Uint8Array(total);
  const crossings = new Float64Array(total * CROSSING_SLOTS);
  let overhangColumns = 0;
  for (let i = zone.i0; i <= zone.i1; i++) {
    for (let j = zone.j0; j <= zone.j1; j++) {
      const scan = params.scanOf(i, j);
      for (let b = 0; b < LEAF_VERTICES; b++) {
        for (let a = 0; a < LEAF_VERTICES; a++) {
          const x = i * LEAF_CELLS + a;
          const y = j * LEAF_CELLS + b;
          const index = (y - B0) * nA + (x - A0);
          if (filled[index]) continue;
          filled[index] = 1;
          const s = (b * LEAF_VERTICES + a) * COLUMN_STRIDE;
          const count = Math.min(scan[s], CROSSING_SLOTS);
          if (count > 1) overhangColumns++;
          const kept = onBoundary(x, y) ? Math.min(count, 1) : count;
          counts[index] = kept;
          for (let c = 0; c < kept; c++) crossings[index * CROSSING_SLOTS + c] = scan[s + 1 + c];
          // No crossing: the scan put the ground at the top of its range (all rock) or the bottom (all air).
          allRock[index] = count === 0 && scan[s + 1] > 0 ? 1 : 0;
        }
      }
    }
  }
  const column = (x: number, y: number): number => (y - B0) * nA + (x - A0);
  /** Lowest and highest crossing of a column, or (Infinity, -Infinity). */
  const range = (col: number, out: [number, number]): [number, number] => {
    for (let n = 0; n < counts[col]; n++) {
      const c = crossings[col * CROSSING_SLOTS + n];
      if (c < out[0]) out[0] = c;
      if (c > out[1]) out[1] = c;
    }
    return out;
  };
  /** Signed vertical distance to the nearest crossing: positive in air, negative in rock. */
  const value = (col: number, r: number): number => {
    const count = counts[col];
    if (count === 0) return allRock[col] ? -1e9 : 1e9;
    let above = 0;
    let nearest = Infinity;
    for (let n = 0; n < count; n++) {
      const c = crossings[col * CROSSING_SLOTS + n];
      if (c > r) above++;
      nearest = Math.min(nearest, Math.abs(c - r));
    }
    return above % 2 === 1 ? -nearest : nearest;
  };
  /** The same, bilinear between the four columns around fractional (x, y). */
  const field = (x: number, y: number, r: number): number => {
    const X = Math.min(A1 - 1, Math.max(A0, Math.floor(x)));
    const Y = Math.min(B1 - 1, Math.max(B0, Math.floor(y)));
    const fx = Math.min(1, Math.max(0, x - X));
    const fy = Math.min(1, Math.max(0, y - Y));
    const v = (a: number, b: number) => Math.max(-1e6, Math.min(1e6, value(column(a, b), r)));
    return (v(X, Y) * (1 - fx) + v(X + 1, Y) * fx) * (1 - fy) + (v(X, Y + 1) * (1 - fx) + v(X + 1, Y + 1) * fx) * fy;
  };

  // Directions of the zone's columns, from their lattice keys (the shell computes the same numbers).
  const directions = new Float64Array(nA * nB * 3);
  const d: Vec3 = [0, 0, 0];
  for (let y = B0; y <= B1; y++) {
    for (let x = A0; x <= A1; x++) {
      latticeDirection(face, latticeCoordinate(level, 0, x), latticeCoordinate(level, 0, y), d);
      directions.set(d, ((y - B0) * nA + (x - A0)) * 3);
    }
  }

  // Vertices: zone coordinates kept for orientation, world positions (origin-relative, doubles) for the mesh.
  const zx: number[] = [];
  const zy: number[] = [];
  const zr: number[] = [];
  const positions: number[] = [];
  const push = (x: number, y: number, r: number): number => {
    const at = (a: number, b: number, k: number) => directions[((b - B0) * nA + (a - A0)) * 3 + k];
    if (Number.isInteger(x) && Number.isInteger(y)) {
      // On a column: its direction exactly, with the shell's arithmetic, so a shared vertex is bit-identical.
      const scale = R + r;
      positions.push(at(x, y, 0) * scale - origin[0], at(x, y, 1) * scale - origin[1], at(x, y, 2) * scale - origin[2]);
    } else {
      const X = Math.min(A1 - 1, Math.max(A0, Math.floor(x)));
      const Y = Math.min(B1 - 1, Math.max(B0, Math.floor(y)));
      const fx = x - X;
      const fy = y - Y;
      const dir = [0, 1, 2].map((k) => (at(X, Y, k) * (1 - fx) + at(X + 1, Y, k) * fx) * (1 - fy) + (at(X, Y + 1, k) * (1 - fx) + at(X + 1, Y + 1, k) * fx) * fy);
      const scale = (R + r) / Math.hypot(dir[0], dir[1], dir[2]);
      positions.push(dir[0] * scale - origin[0], dir[1] * scale - origin[1], dir[2] * scale - origin[2]);
    }
    zx.push(x);
    zy.push(y);
    zr.push(r);
    return zx.length - 1;
  };

  // Surface-nets vertices: one per cell with mixed corner signs, at the mean of its edge crossings.
  const vertexOf = new Map<number, number>();
  /** Vertices of the seam: the boundary cells', the shell vertices and the contour points. */
  const seamVertex = new Set<number>();
  const kOffset = 1 << 20;
  const cellKey = (x: number, y: number, k: number) => ((y - B0) * nA + (x - A0)) * (kOffset * 2) + (k + kOffset);
  const cell = (x: number, y: number, k: number) => vertexOf.get(cellKey(x, y, k));
  const corners = new Float64Array(8);
  let cells = 0;
  const visible = params.visible ?? (() => true);
  for (let y = B0; y < B1; y++) {
    for (let x = A0; x < A1; x++) {
      if (!visible(Math.floor(x / LEAF_CELLS), Math.floor(y / LEAF_CELLS))) continue;
      const cols = [column(x, y), column(x + 1, y), column(x, y + 1), column(x + 1, y + 1)];
      const bounds: [number, number] = [Infinity, -Infinity];
      for (const col of cols) range(col, bounds);
      const [lo, hi] = bounds;
      if (lo > hi) continue;
      for (let k = Math.floor(lo / cellM) - 1; k < Math.ceil(hi / cellM) + 1; k++) {
        const r0 = k * cellM;
        const r1 = r0 + cellM;
        let rock = 0;
        for (let c = 0; c < 4; c++) {
          corners[c] = value(cols[c], r0);
          corners[c + 4] = value(cols[c], r1);
          if (corners[c] < 0) rock++;
          if (corners[c + 4] < 0) rock++;
        }
        if (rock === 0 || rock === 8) continue;
        let sx = 0;
        let sy = 0;
        let sr = 0;
        let n = 0;
        const add = (px: number, py: number, pr: number) => { sx += px; sy += py; sr += pr; n++; };
        for (let c = 0; c < 4; c++) {
          if ((corners[c] < 0) === (corners[c + 4] < 0)) continue;
          for (let m = 0; m < counts[cols[c]]; m++) {
            const root = crossings[cols[c] * CROSSING_SLOTS + m];
            if (root > r0 && root <= r1) {
              add(x + (c & 1), y + (c >> 1), root);
              break;
            }
          }
        }
        for (const [offset, r] of [[0, r0], [4, r1]] as const) {
          for (const [c0, c1] of [[0, 1], [2, 3], [0, 2], [1, 3]]) {
            const v0 = corners[c0 + offset];
            const v1 = corners[c1 + offset];
            if ((v0 < 0) === (v1 < 0)) continue;
            const t = v0 / (v0 - v1);
            add(x + (c0 & 1) + ((c1 & 1) - (c0 & 1)) * t, y + (c0 >> 1) + ((c1 >> 1) - (c0 >> 1)) * t, r);
          }
        }
        if (n === 0) continue;
        const v = push(sx / n, sy / n, sr / n);
        vertexOf.set(cellKey(x, y, k), v);
        if (x === A0 || x === A1 - 1 || y === B0 || y === B1 - 1) seamVertex.add(v);
        cells++;
      }
    }
  }

  const indices: number[] = [];
  /** Directed edges emitted so far, for the fans' winding. */
  const directed = new Set<number>();
  const edge = (a: number, b: number) => a * 2 ** 26 + b;
  const emit = (v0: number, v1: number, v2: number) => {
    indices.push(v0, v1, v2);
    // Only edges between vertices of the seam (boundary cells, shell vertices, contour points) are ever looked up.
    if (seamVertex.has(v0) && seamVertex.has(v1)) directed.add(edge(v0, v1));
    if (seamVertex.has(v1) && seamVertex.has(v2)) directed.add(edge(v1, v2));
    if (seamVertex.has(v2) && seamVertex.has(v0)) directed.add(edge(v2, v0));
  };
  /**
   * A triangle of the seam, wound to match a neighbour already emitted (a shared edge must run the other way), else
   * counter-clockwise (in zone coordinates) seen from the air side of the column field.
   */
  const triangle = (v0: number, v1: number, v2: number) => {
    if (v0 === v1 || v1 === v2 || v0 === v2) return;
    if (directed.has(edge(v0, v1)) || directed.has(edge(v1, v2)) || directed.has(edge(v2, v0))) return emit(v0, v2, v1);
    if (directed.has(edge(v1, v0)) || directed.has(edge(v2, v1)) || directed.has(edge(v0, v2))) return emit(v0, v1, v2);
    const u = [zx[v1] - zx[v0], zy[v1] - zy[v0], (zr[v1] - zr[v0]) / cellM];
    const w = [zx[v2] - zx[v0], zy[v2] - zy[v0], (zr[v2] - zr[v0]) / cellM];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const length = Math.hypot(n[0], n[1], n[2]);
    if (length === 0) return emit(v0, v1, v2);
    const e = 0.25 / length;
    const cx = (zx[v0] + zx[v1] + zx[v2]) / 3;
    const cy = (zy[v0] + zy[v1] + zy[v2]) / 3;
    const cr = (zr[v0] + zr[v1] + zr[v2]) / 3;
    const ahead = field(cx + n[0] * e, cy + n[1] * e, cr + n[2] * e * cellM);
    const behind = field(cx - n[0] * e, cy - n[1] * e, cr - n[2] * e * cellM);
    if (ahead >= behind) emit(v0, v1, v2);
    else emit(v0, v2, v1);
  };
  /**
   * A surface-nets quad around a grid edge from `rock` to `air` (zone coordinates of its two ends), wound
   * counter-clockwise seen from `air`; both triangles the same way.
   */
  const quad = (q: readonly (number | undefined)[], rock: readonly number[], air: readonly number[]) => {
    if (q.some((v) => v === undefined)) return;
    const [a, b, c, e] = q as number[];
    const d1 = [zx[c] - zx[a], zy[c] - zy[a], (zr[c] - zr[a]) / cellM];
    const d2 = [zx[e] - zx[b], zy[e] - zy[b], (zr[e] - zr[b]) / cellM];
    const n = [d1[1] * d2[2] - d1[2] * d2[1], d1[2] * d2[0] - d1[0] * d2[2], d1[0] * d2[1] - d1[1] * d2[0]];
    const toward = n[0] * (air[0] - rock[0]) + n[1] * (air[1] - rock[1]) + (n[2] * (air[2] - rock[2])) / cellM;
    const [p0, p1, p2, p3] = toward >= 0 ? [a, b, c, e] : [a, e, c, b];
    if (p0 !== p1 && p1 !== p2 && p0 !== p2) emit(p0, p1, p2);
    if (p0 !== p2 && p2 !== p3 && p0 !== p3) emit(p0, p2, p3);
  };

  // Interior quads: one per grid edge that changes sign, between the four cells around it. Edges on the zone's
  // boundary faces are left to the seam below.
  for (let y = B0 + 1; y < B1; y++) {
    for (let x = A0 + 1; x < A1; x++) {
      const here = column(x, y);
      const seen = new Set<number>();
      for (let m = 0; m < counts[here]; m++) {
        const k = Math.floor(crossings[here * CROSSING_SLOTS + m] / cellM);
        // Two roots in one level cancel: no sign change along that edge.
        if (seen.has(k) || (value(here, k * cellM) < 0) === (value(here, (k + 1) * cellM) < 0)) continue;
        seen.add(k);
        const rockBelow = value(here, k * cellM) < 0;
        quad([cell(x - 1, y - 1, k), cell(x, y - 1, k), cell(x, y, k), cell(x - 1, y, k)],
          [x, y, rockBelow ? k * cellM : (k + 1) * cellM], [x, y, rockBelow ? (k + 1) * cellM : k * cellM]);
      }
    }
  }
  for (const alongX of [true, false]) {
    for (let y = B0; y <= (alongX ? B1 : B1 - 1); y++) {
      for (let x = A0; x <= (alongX ? A1 - 1 : A1); x++) {
        if (alongX ? y === B0 || y === B1 : x === A0 || x === A1) continue;
        const c0 = column(x, y);
        const c1 = alongX ? column(x + 1, y) : column(x, y + 1);
        const [lo, hi] = range(c1, range(c0, [Infinity, -Infinity]));
        if (lo > hi) continue;
        for (let k = Math.floor(lo / cellM); k <= Math.ceil(hi / cellM); k++) {
          const r = k * cellM;
          const rockHere = value(c0, r) < 0;
          if (rockHere === (value(c1, r) < 0)) continue;
          const there = alongX ? [x + 1, y, r] : [x, y + 1, r];
          quad(alongX
            ? [cell(x, y - 1, k - 1), cell(x, y, k - 1), cell(x, y, k), cell(x, y - 1, k)]
            : [cell(x - 1, y, k - 1), cell(x, y, k - 1), cell(x, y, k), cell(x - 1, y, k)],
          rockHere ? [x, y, r] : there, rockHere ? there : [x, y, r]);
        }
      }
    }
  }

  // The seam, face by face: `at(s)` is the boundary column at position s along the face, `inside(s, k)` the zone cell
  // next to the face cell between columns s and s + 1 at level k.
  const boundaryHeights = new Map<string, number>();
  const sides: { side: ZoneSide; at: (s: number) => [number, number]; inside: (s: number, k: number) => number | undefined; length: number }[] = [
    { side: 0, at: (s) => [A0, B0 + s], inside: (s, k) => cell(A0, B0 + s, k), length: nB - 1 },
    { side: 1, at: (s) => [A1, B0 + s], inside: (s, k) => cell(A1 - 1, B0 + s, k), length: nB - 1 },
    { side: 2, at: (s) => [A0 + s, B0], inside: (s, k) => cell(A0 + s, B0, k), length: nA - 1 },
    { side: 3, at: (s) => [A0 + s, B1], inside: (s, k) => cell(A0 + s, B1 - 1, k), length: nA - 1 },
  ];
  /** Shell vertices by boundary column, shared by the two sides that meet at a corner. */
  const shellVertexAt = new Map<number, number>();
  for (const { side, at, inside, length } of sides) {
    const height = (s: number) => {
      const col = column(...at(s));
      return counts[col] ? crossings[col * CROSSING_SLOTS] : allRock[col] ? 1e6 : -1e6;
    };
    const shellVertex: number[] = [];
    for (let s = 0; s <= length; s++) {
      const [x, y] = at(s);
      const key = (y - B0) * nA + (x - A0);
      let v = shellVertexAt.get(key);
      if (v === undefined) {
        shellVertexAt.set(key, (v = push(x, y, height(s))));
        seamVertex.add(v);
        boundaryHeights.set(latticeKey(face, latticeCoordinate(level, 0, x), latticeCoordinate(level, 0, y)), height(s));
      }
      shellVertex.push(v);
    }
    // A crossing on an inner boundary column joins the inside cells on either side of it (first: these share an edge
    // with an interior quad, so they take its winding, and the rest of the seam follows from them).
    for (let s = 1; s < length; s++) {
      const k = Math.floor(height(s) / cellM);
      const c0 = inside(s - 1, k);
      const c1 = inside(s, k);
      if (c0 !== undefined && c1 !== undefined) triangle(c0, c1, shellVertex[s]);
    }
    // Contour points between columns s and s + 1, where the face's horizontal edges change sign, ordered from column
    // s's crossing toward column s + 1's; and the strip from the inside cells to them.
    const between: number[][] = [];
    for (let s = 0; s < length; s++) {
      const h0 = height(s);
      const h1 = height(s + 1);
      const [x0, y0] = at(s);
      const [x1, y1] = at(s + 1);
      const ks: number[] = [];
      for (let k = Math.ceil(Math.min(h0, h1) / cellM); k * cellM < Math.max(h0, h1); k++) ks.push(k);
      if (h1 < h0) ks.reverse();
      const points = ks.map((k) => {
        const t = (k * cellM - h0) / (h1 - h0);
        const v = push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, k * cellM);
        seamVertex.add(v);
        return v;
      });
      between.push(points);
      // A contour point on the horizontal edge at level k joins the two inside cells around that edge.
      ks.forEach((k, n) => {
        const c0 = inside(s, k - 1);
        const c1 = inside(s, k);
        if (c0 !== undefined && c1 !== undefined) triangle(c0, c1, points[n]);
      });
      // Each segment of the contour joins the inside cell next to the face cell that holds it.
      const chain = [shellVertex[s], ...points, shellVertex[s + 1]];
      const chainLevels = [h0, ...ks.map((k) => k * cellM)];
      for (let n = 0; n + 1 < chain.length; n++) {
        const from = chainLevels[n];
        const k = h1 >= h0 ? Math.floor((from + 1e-9) / cellM) : Math.ceil((from - 1e-9) / cellM) - 1;
        const c = inside(s, k);
        if (c !== undefined) triangle(chain[n], chain[n + 1], c);
      }
    }
    // Fans from each shell edge (every column, or every other one next to a coarser leaf) to the contour between its
    // vertices, wound against the strip so the shared edges run both ways.
    for (let s = 0; s < length;) {
      const [x, y] = at(s);
      const coarser = params.outsideLevel(side, x, y) < level;
      const span = coarser && (side < 2 ? y : x) % 2 === 0 && s + 2 <= length ? 2 : 1;
      const polygon = [shellVertex[s]];
      for (let n = 0; n < span; n++) polygon.push(...between[s + n], shellVertex[s + n + 1]);
      if (polygon.length > 2) {
        const forward = !directed.has(edge(polygon[0], polygon[1]));
        for (let n = 1; n + 1 < polygon.length; n++) {
          if (forward) emit(polygon[0], polygon[n], polygon[n + 1]);
          else emit(polygon[0], polygon[n + 1], polygon[n]);
        }
      }
      s += span;
    }
  }

  // Zone coordinates are right-handed with the outward normal on the positive faces only.
  if (face & 1) {
    for (let t = 0; t < indices.length; t += 3) [indices[t + 1], indices[t + 2]] = [indices[t + 2], indices[t + 1]];
  }

  // Normals: area-weighted face normals at each vertex.
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const [i0, i1, i2] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
    const u = [positions[i1] - positions[i0], positions[i1 + 1] - positions[i0 + 1], positions[i1 + 2] - positions[i0 + 2]];
    const w = [positions[i2] - positions[i0], positions[i2 + 1] - positions[i0 + 1], positions[i2 + 2] - positions[i0 + 2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    for (const i of [i0, i1, i2]) {
      normals[i] += n[0];
      normals[i + 1] += n[1];
      normals[i + 2] += n[2];
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= length;
    normals[i + 1] /= length;
    normals[i + 2] /= length;
  }
  return { positions: Float32Array.from(positions), normals, indices: Uint32Array.from(indices), boundaryHeights, cells, overhangColumns };
}
