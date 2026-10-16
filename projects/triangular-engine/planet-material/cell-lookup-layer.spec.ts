import { vec3, vec4 } from 'three/tsl';
import { cellLookupLayer, type ICellLookupPayload } from './cell-lookup-layer';
import { evaluateOnGpu } from './gpu-eval.testing';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('cellLookupLayer on the GPU', () => {
  const W = 4;
  const H = 2;
  // Two-byte ids, so the `r + g * 256` decode is exercised: the second atlas row is 300 + x.
  const ids = [0, 1, 2, 3, 300, 301, 302, 303];
  const cellCount = 304;

  function payload(): ICellLookupPayload {
    const cellIdData = new Uint8Array(W * H * 4);
    ids.forEach((id, i) => {
      cellIdData[i * 4] = id & 255;
      cellIdData[i * 4 + 1] = (id >> 8) & 255;
      cellIdData[i * 4 + 3] = 255;
    });
    const cellData = new Float32Array(cellCount * 4);
    for (let c = 0; c < cellCount; c += 1) {
      cellData.set([(c % 7) / 7, (c % 5) / 5, (c % 3) / 3, 1], c * 4);
    }
    cellData.set([1, 1, 1, 0.5], 301 * 4); // half-weight cell
    return { cellData, cellTextureWidth: cellCount, cellIdData, cellIdWidth: W, cellIdHeight: H };
  }

  /** Direction through the centre of atlas texel (x, y). */
  const texelDirection = (x: number, y: number): [number, number, number, number] => {
    const lon = -Math.PI + ((x + 0.5) / W) * 2 * Math.PI;
    const lat = -Math.PI / 2 + ((y + 0.5) / H) * Math.PI;
    return [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon), 0];
  };

  async function colours(configure: (l: ReturnType<typeof cellLookupLayer>) => void) {
    const lookup = cellLookupLayer();
    configure(lookup);
    const texels = [...Array(H).keys()].flatMap((y) => [...Array(W).keys()].map((x) => [x, y]));
    const rows = texels.map(([x, y]) => [texelDirection(x, y)]);
    const out = await evaluateOnGpu(rows, (at) => {
      const sample = lookup.layer(
        { sphereNormal: at(0).xyz } as any,
        { albedo: vec3(0.2, 0.2, 0.2), roughness: 1, metalness: 0 } as any,
      );
      return vec4(sample.albedo, 1);
    });
    lookup.dispose();
    return texels.map((_, i) => [out[i * 4], out[i * 4 + 1], out[i * 4 + 2]]);
  }

  it('looks each direction up through the id atlas and the colour table', async () => {
    const p = payload();
    const result = await colours((l) => l.setLookup(p));
    ids.forEach((id, i) => {
      if (id === 301) return; // half weight, covered below
      const expected = [p.cellData[id * 4], p.cellData[id * 4 + 1], p.cellData[id * 4 + 2]];
      expected.forEach((v, k) => expect(result[i][k]).withContext(`cell ${id} channel ${k}`).toBeCloseTo(v, 3));
    });
  });

  it('blends by the cell alpha times the layer opacity', async () => {
    const result = await colours((l) => {
      l.setLookup(payload());
      l.opacity.value = 0.5;
    });
    // Cell 301 has alpha 0.5, opacity 0.5: 25% of white over 0.2.
    expect(result[5][0]).toBeCloseTo(0.2 + (1 - 0.2) * 0.25, 3);
  });

  it('passes the layer below through until a lookup is uploaded', async () => {
    const result = await colours(() => undefined);
    result.forEach((rgb) => rgb.forEach((v) => expect(v).toBeCloseTo(0.2, 4)));
  });
});
