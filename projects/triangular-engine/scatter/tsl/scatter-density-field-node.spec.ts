import { vec4 } from 'three/tsl';
import { evaluateScatterDensityField, type IScatterDensityFieldDefinition } from 'triangular-engine/scatter';
import { evaluateOnGpu } from '../../planet-material/gpu-eval.testing';
import { scatterDensityFieldNode } from './scatter-density-field-node';

const RADIUS_M = 600_000;
const fields: Record<string, IScatterDensityFieldDefinition> = {
  forest: {
    octaves: [
      { cellM: 6000, weight: 0.55 },
      { cellM: 1500, weight: 0.3 },
      { cellM: 120, weight: 0.15 },
    ],
    edge: [0.45, 0.62],
    heightBandM: { rise: [5, 40], fall: [1800, 2600] },
  },
  rocks: {
    octaves: [
      { cellM: 320, weight: 0.6 },
      { cellM: 45, weight: 0.4 },
    ],
    octaveOffset: 5,
    edge: [0.5, 0.72],
    heightBandM: { rise: [5, 40] },
  },
};

describe('scatterDensityFieldNode (CPU and TSL parity)', () => {
  for (const [name, field] of Object.entries(fields)) {
    it(`matches evaluateScatterDensityField at planet scale (${name})`, async () => {
      // Points all over the sphere, in every octant (negative lattice indices), a few hundred metres up.
      const n = 256;
      const rows = Array.from({ length: n }, (_, i) => {
        const lon = i * 0.37;
        const lat = Math.sin(i * 0.11) * 1.2;
        const h = 60 + (i % 50) * 30;
        const r = RADIUS_M + h;
        return [[Math.cos(lat) * Math.sin(lon) * r, Math.sin(lat) * r, Math.cos(lat) * Math.cos(lon) * r, h]];
      });
      const gpu = await evaluateOnGpu(rows, (at) => {
        const p = at(0);
        return vec4(scatterDensityFieldNode(field, p.xyz, p.w), 0, 0, 1);
      });
      let worst = 0;
      let nonZero = 0;
      for (let i = 0; i < n; i++) {
        const [x, y, z, h] = rows[i][0];
        const cpu = evaluateScatterDensityField(field, x, y, z, h);
        if (cpu > 0) nonZero++;
        worst = Math.max(worst, Math.abs(cpu - gpu[i * 4]));
      }
      expect(nonZero).toBeGreaterThan(10);
      // float32 on the GPU at 600 km carries a few centimetres of error; the field must not care.
      expect(worst).toBeLessThan(0.01);
    });
  }
});
