import { vec3, vec4 } from 'three/tsl';
import { CELL_VORONOI_NEIGHBOURS, cellVoronoiLayer, type ICellVoronoiPayload } from './cell-voronoi-layer';
import { evaluateOnGpu } from './gpu-eval.testing';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('cellVoronoiLayer on the GPU', () => {
  // An octahedron: six cells on the axes. Every cell touches the four that are not on its own axis.
  const centres: readonly [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const axisOf = (c: number) => c >> 1;
  const colour = (c: number): [number, number, number] => [(c + 1) / 7, 0.5, 1 - (c + 1) / 7];

  /** The atlas says "cell 0" everywhere, which is wrong except near +x: the layer has to find the true cell itself. */
  function payload(): ICellVoronoiPayload {
    const cellData = new Float32Array(6 * 4);
    centres.forEach((_, c) => cellData.set([...colour(c), 1], c * 4));
    const cellNeighbours = new Int32Array(6 * CELL_VORONOI_NEIGHBOURS).fill(-1);
    centres.forEach((_, c) => {
      const near = [0, 1, 2, 3, 4, 5].filter((o) => axisOf(o) !== axisOf(c));
      near.forEach((id, k) => (cellNeighbours[c * CELL_VORONOI_NEIGHBOURS + k] = id));
    });
    return {
      cellData, cellTextureWidth: 6,
      cellIdData: new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]), cellIdWidth: 2, cellIdHeight: 2,
      cellCentres: new Float32Array(centres.flat()), cellNeighbours,
    };
  }

  const nearest = (d: readonly number[]): number =>
    centres.reduce((best, c, i) => (c[0] * d[0] + c[1] * d[1] + c[2] * d[2] > centres[best][0] * d[0] + centres[best][1] * d[1] + centres[best][2] * d[2] ? i : best), 0);

  async function paint(directions: readonly (readonly number[])[], configure: (l: ReturnType<typeof cellVoronoiLayer>) => void) {
    const lookup = cellVoronoiLayer();
    configure(lookup);
    const out = await evaluateOnGpu(directions.map((d) => [[d[0], d[1], d[2], 0]]), (at) =>
      vec4(lookup.layer({ radialDirection: at(0).xyz } as any, { albedo: vec3(0.2, 0.2, 0.2), roughness: 1, metalness: 0 } as any).albedo, 1),
    );
    lookup.dispose();
    return directions.map((_, i) => [out[i * 4], out[i * 4 + 1], out[i * 4 + 2]]);
  }

  it('picks the cell with the nearest centre among the atlas cell and its neighbours, whatever the atlas says', async () => {
    // Directions whose nearest cell is any but -x (that cell is not a neighbour of the atlas's cell 0 only by the atlas; it is
    // excluded here because the atlas cell must be within one cell of the truth).
    const directions: number[][] = [];
    for (let i = 0; i < 60; i += 1) {
      const a = i * 2.399963;
      const z = 1 - ((i + 0.5) / 60) * 2 * 0.95;
      const r = Math.sqrt(1 - z * z);
      directions.push([Math.abs(r * Math.cos(a)), r * Math.sin(a), z]);
    }
    const result = await paint(directions, (l) => l.setLookup(payload()));
    directions.forEach((d, i) => {
      const expected = colour(nearest(d));
      expected.forEach((v, k) => expect(result[i][k]).withContext(`direction ${d.map((n) => n.toFixed(2))} channel ${k}`).toBeCloseTo(v, 3));
    });
    // Both +y and -z cells are really reached, so the test is not satisfied by one colour.
    const owners = new Set(directions.map(nearest));
    expect(owners.size).toBeGreaterThan(3);
  });

  it('has a straight edge: two directions a hair either side of the plane between two cells get the two colours', async () => {
    const e = 1e-4;
    const result = await paint([[1, 1 - e, 0], [1, 1 + e, 0]], (l) => l.setLookup(payload()));
    colour(0).forEach((v, k) => expect(result[0][k]).toBeCloseTo(v, 3));
    colour(2).forEach((v, k) => expect(result[1][k]).toBeCloseTo(v, 3));
  });

  it('passes the layer below through until a lookup is uploaded', async () => {
    const result = await paint([[1, 0, 0]], () => undefined);
    result[0].forEach((v) => expect(v).toBeCloseTo(0.2, 4));
  });

  it('rejects centres or neighbours that do not match the cell count', () => {
    const lookup = cellVoronoiLayer();
    expect(() => lookup.setLookup({ ...payload(), cellCentres: new Float32Array(3) })).toThrowError(RangeError);
    expect(() => lookup.setLookup({ ...payload(), cellNeighbours: new Int32Array(8) })).toThrowError(RangeError);
    lookup.dispose();
  });

  it('rewrites the colour table in place', async () => {
    const result = await paint([[1, 0, 0]], (l) => {
      l.setLookup(payload());
      l.updatePalette(new Float32Array(6 * 4).fill(1));
    });
    result[0].forEach((v) => expect(v).toBeCloseTo(1, 3));
  });
});
