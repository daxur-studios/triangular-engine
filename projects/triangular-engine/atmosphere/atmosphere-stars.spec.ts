import { Fn, vec4 } from 'three/tsl';
import { evaluateOnGpu, type GpuRow } from '../planet-material/gpu-eval.testing';
import {
  STAR_FIELD_LAYERS,
  STAR_SIGMA_PIXELS,
  starField,
  starFieldAt,
  starFieldCell,
  starFieldStar,
  starHash,
  type StarFieldStar,
} from './atmosphere-stars';

type Vec3 = [number, number, number];

/** The first `count` stars of a layer on a face, walking its cells from a start. */
function starsOf(layerIndex: number, face: number, count: number, start = 0): StarFieldStar[] {
  const layer = STAR_FIELD_LAYERS[layerIndex];
  const out: StarFieldStar[] = [];
  for (let k = start; out.length < count; k++) {
    const star = starFieldStar(layer, face, k % layer.cells, Math.floor(k / layer.cells) % layer.cells);
    if (star) out.push(star);
  }
  return out;
}

/** `d` turned by `angle` radians toward a direction perpendicular to it. */
function offset(d: readonly number[], angle: number): Vec3 {
  const ref = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const t = [d[1] * ref[2] - d[2] * ref[1], d[2] * ref[0] - d[0] * ref[2], d[0] * ref[1] - d[1] * ref[0]];
  const l = Math.hypot(t[0], t[1], t[2]);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [d[0] * c + (t[0] / l) * s, d[1] * c + (t[1] / l) * s, d[2] * c + (t[2] / l) * s];
}

describe('star field', () => {
  it('hashes the same 32-bit integers the shader does', () => {
    expect(starHash(0)).toBe(0);
    expect(starHash(1)).toBe(starHash(1));
    expect(starHash(1)).not.toBe(starHash(2));
    for (const x of [1, 12345, 0x7fffffff, 0xffffffff]) {
      expect(Number.isInteger(starHash(x))).toBeTrue();
      expect(starHash(x)).toBeGreaterThanOrEqual(0);
      expect(starHash(x)).toBeLessThan(2 ** 32);
    }
  });

  it('fills each layer at its density and finds a star back in its own cell', () => {
    for (const layer of STAR_FIELD_LAYERS) {
      let stars = 0;
      const n = layer.cells;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const star = starFieldStar(layer, 3, i, j);
          if (!star) continue;
          stars++;
          if ((i + j) % 17 === 0) expect(starFieldCell(star.direction, n)).toEqual({ face: 3, i, j });
        }
      }
      expect(stars / (n * n)).toBeCloseTo(layer.density, 1);
    }
  });

  it('hides a layer whose cells are under a few pixels across', () => {
    const fine = [STAR_FIELD_LAYERS[2]];
    const [star] = starsOf(2, 0, 1);
    expect(starFieldAt(star.direction, 1e-4, fine)[1]).toBeCloseTo(star.radiance[1], 6);
    // 280 cells per face edge: 5.6 mrad per cell, 2.2 pixels at 2.5 mrad per pixel.
    expect(starFieldAt(star.direction, 2.5e-3, fine)).toEqual([0, 0, 0]);
  });

  it('draws on the GPU what the CPU twin finds: centres, flanks and empty sky', async () => {
    const cases: { dir: Vec3; pixelAngle: number }[] = [];
    STAR_FIELD_LAYERS.forEach((_, layerIndex) => {
      for (const face of [0, 3, 5]) {
        for (const star of starsOf(layerIndex, face, 3, 40 * face + 7)) {
          for (const pixelAngle of [1e-4, 1.5e-3]) {
            const sigma = pixelAngle * STAR_SIGMA_PIXELS;
            for (const k of [0, 1, 2, 4]) cases.push({ dir: offset(star.direction, k * sigma), pixelAngle });
          }
        }
      }
    });
    // Directions picked without regard to the stars: almost all empty sky.
    for (let k = 0; k < 24; k++) {
      const a = k * 2.399963;
      const z = 1 - (2 * (k + 0.5)) / 24;
      const r = Math.sqrt(1 - z * z);
      cases.push({ dir: [r * Math.cos(a), z, r * Math.sin(a)], pixelAngle: 1e-3 });
    }

    const rows: GpuRow[] = cases.map((c) => [[...c.dir, c.pixelAngle]]);
    const out = await evaluateOnGpu(rows, (at) =>
      Fn(() => {
        const a = at(0);
        return vec4(starField(a.xyz, a.w), 1);
      })(),
    );

    let lit = 0;
    cases.forEach((c, k) => {
      const expected = starFieldAt(c.dir, c.pixelAngle);
      if (expected[1] > 1e-3) lit++;
      for (let ch = 0; ch < 3; ch++) {
        const got = out[k * 4 + ch];
        expect(Math.abs(got - expected[ch])).withContext(`case ${k} channel ${ch}`).toBeLessThan(1e-3 + 0.01 * expected[ch]);
      }
    });
    // The centres and near flanks are lit, so the comparison is not of zeros alone.
    expect(lit).toBeGreaterThan(cases.length / 3);
  }, 30_000);
});
