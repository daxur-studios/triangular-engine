import { CAP_SEGMENTS, gridGeometry } from './morph-surface-mesh';

const CELLS = 16;

describe('morph surface mesh: the grid with pole caps', () => {
  const geometry = gridGeometry(CELLS, 4);
  const side = CELLS + 1;
  const regular = side * side;
  const copies = CAP_SEGMENTS + 1;
  const positions = geometry.getAttribute('position').array as Float32Array;
  const index = geometry.getIndex()!.array as Uint32Array;

  it('adds CAP_SEGMENTS triangles per corner to the two per cell, and CAP_SEGMENTS + 1 copies per corner flagged 1 .. CAP_SEGMENTS + 1 in z', () => {
    expect(positions.length / 3).toBe(regular + 4 * copies);
    expect(index.length / 3).toBe(2 * CELLS * CELLS + 4 * CAP_SEGMENTS);
    for (let c = 0; c < 4; c++) {
      const x = positions[(regular + copies * c) * 3];
      const y = positions[(regular + copies * c) * 3 + 1];
      expect([0, CELLS]).toContain(x);
      expect([0, CELLS]).toContain(y);
      for (let j = 0; j < copies; j++) {
        expect(positions[(regular + copies * c + j) * 3]).toBe(x);
        expect(positions[(regular + copies * c + j) * 3 + 1]).toBe(y);
        expect(positions[(regular + copies * c + j) * 3 + 2]).toBe(j + 1);
      }
      // The corner's own grid vertex is no longer drawn by any triangle.
      expect(Array.from(index).includes(y * side + x)).toBeFalse();
    }
  });

  it('leaves the cells that hold no corner exactly as the plain grid', () => {
    const plain = new Set<string>();
    for (let y = 0; y < CELLS; y++) {
      for (let x = 0; x < CELLS; x++) {
        if ((x === 0 || x === CELLS - 1) && (y === 0 || y === CELLS - 1)) continue;
        const a = y * side + x;
        plain.add([a, a + 1, a + side + 1].join());
        plain.add([a, a + side + 1, a + side].join());
      }
    }
    const drawn = new Set<string>();
    for (let t = 0; t < index.length; t += 3) drawn.add([index[t], index[t + 1], index[t + 2]].join());
    for (const triangle of plain) expect(drawn.has(triangle)).toBeTrue();
  });

  /**
   * A pole at each corner in turn, a leaf a quarter of the map wide: the corner is the top edge of the map (y = 1), the x edge's
   * vertices lie on the meridian lonX and the y edge's on lonY, the others in between by their angle around the corner, a row
   * `0.01 * distance` below the top edge; copy j of the corner sits on the edge at lonX + (lonY - lonX) j / CAP_SEGMENTS. The
   * triangles of the corner's cell must tile the polygon the cell has on the map (the top edge from lonX to lonY down to the
   * neighbours and the diagonal): the sum of their areas is the polygon's, so there is no gap and no overlap.
   */
  it('tiles the corner cell of a pole corner as the polygon under the map edge, at every corner', () => {
    const lonX = 0;
    const lonY = Math.PI / 2;
    const corners: [number, number][] = [[0, 0], [CELLS, 0], [0, CELLS], [CELLS, CELLS]];
    corners.forEach(([cx, cy], c) => {
      const dx = cx === 0 ? 1 : -1;
      const dy = cy === 0 ? 1 : -1;
      const first = regular + copies * c;
      const position = (v: number): [number, number] => {
        if (v >= regular) {
          if (v < first || v >= first + copies) return [1e9, 1e9];
          return [lonX + ((lonY - lonX) * (v - first)) / CAP_SEGMENTS, 1];
        }
        const gx = v % side;
        const gy = (v - gx) / side;
        const i = Math.abs(gx - cx);
        const j = Math.abs(gy - cy);
        const theta = Math.atan2(j, i) / (Math.PI / 2);
        return [lonX + theta * (lonY - lonX), 1 - 0.01 * Math.hypot(i, j)];
      };
      const E = cy * side + (cx + dx);
      const N = (cy + dy) * side + cx;
      const D = (cy + dy) * side + (cx + dx);
      const members = new Set([E, N, D]);
      for (let j = 0; j < copies; j++) members.add(first + j);
      let area = 0;
      let count = 0;
      for (let t = 0; t < index.length; t += 3) {
        const tri = [index[t], index[t + 1], index[t + 2]];
        if (!tri.every((v) => members.has(v))) continue;
        const [pa, pb, pd] = tri.map(position);
        area += Math.abs((pb[0] - pa[0]) * (pd[1] - pa[1]) - (pd[0] - pa[0]) * (pb[1] - pa[1])) / 2;
        count++;
      }
      const polygon: [number, number][] = [position(first), position(E), position(D), position(N)];
      for (let j = copies - 1; j >= 0; j--) polygon.push(position(first + j));
      let shoelace = 0;
      for (let k = 0; k < polygon.length; k++) {
        const p = polygon[k];
        const q = polygon[(k + 1) % polygon.length];
        shoelace += p[0] * q[1] - q[0] * p[1];
      }
      // The two cell triangles' replacements plus the fan (CAP_SEGMENTS triangles); at the corners that hold the corner in one triangle
      // the replacement is the quad's fan and the cell's other triangle: also CAP_SEGMENTS + 2.
      expect(count).toBe(CAP_SEGMENTS + 2);
      expect(area).toBeCloseTo(Math.abs(shoelace) / 2, 12);
    });
  });
});
