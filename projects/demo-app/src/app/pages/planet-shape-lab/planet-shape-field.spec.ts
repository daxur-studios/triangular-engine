/* eslint-disable @typescript-eslint/no-explicit-any */
import { Matrix3, Vector3 } from 'three';
import { float, uniform, vec4 } from 'three/tsl';
import { evaluateOnGpu } from '../../../../../triangular-engine/planet-material/gpu-eval.testing';
import {
  MASK_OFFSETS, ROCK_OCTAVES, bottomAltitudeM, canyonAt, densityAt, fieldFrameMatrices, noiseOrigin, rockAt, sampleFrame, topAltitudeM,
  unitM, type FieldNodes, type NoiseFrameNodes,
} from './planet-shape-field';
import { createTerrainFieldCpu, valueNoiseCpu } from './planet-shape-field-cpu';
import { NOISE_PERIOD, createNoiseTexture, generateNoiseBytes } from './planet-shape-noise';

/**
 * GPU/CPU parity of the v2 terrain field. The GPU side uses the smooth (four-tap) noise path: the hardware-filtered path
 * blends with 8-bit weights and steps slightly, so it is not expected to match the twin to float precision.
 * Tolerances are stated per quantity below; density is in metres, the others are unitless.
 */

const NOISE_TOLERANCE = 2e-3;
const MASK_TOLERANCE = 5e-3;
const ROCK_TOLERANCE = 3e-3;
/** Density tolerance as a share of the relief unit (a tenth of the relief), plus a float32 allowance on the altitude. */
const DENSITY_TOLERANCE_UNITS = 0.01;

const BODY_RADII_M = [20_000, 1_737_400, 6_371_000];

type V3 = [number, number, number];

/** Deterministic points near the surface: a camera position at a spread of directions, and a camera-relative offset. */
function samplePoints(radiusM: number): { camera: V3; x: V3 }[] {
  const unit = unitM(radiusM);
  const directions: V3[] = [
    [0.3, 0.2, 0.93], [0.9, 0.1, 0.42], [-0.5, 0.7, 0.51], [0.1, -0.95, 0.29], [-0.8, -0.4, -0.45],
    [0.6, 0.6, -0.53], [0.99, 0.05, 0.1], [0.02, 0.01, 0.9997], [-0.2, 0.3, 0.93], [0.7, -0.7, 0.14],
  ];
  const points: { camera: V3; x: V3 }[] = [];
  directions.forEach((d, i) => {
    const length = Math.hypot(...d);
    const altitude = unit * (-1 + (i % 5) * 1.2);
    const r = radiusM + altitude;
    const camera: V3 = [(d[0] / length) * r, (d[1] / length) * r, (d[2] / length) * r];
    for (let k = 0; k < 4; k++) {
      const s = unit * (0.5 + k * 1.1);
      points.push({ camera, x: [s * Math.cos(i + k), s * Math.sin(i * 2 + k), s * Math.cos(k * 1.7 + i)] });
    }
  });
  return points;
}

interface Evaluated { noise: number; canyon: number; rock: number; density: number }

async function evaluate(radiusM: number, points: { camera: V3; x: V3 }[]): Promise<{ gpu: Evaluated[]; cpu: Evaluated[]; altitudes: number[] }> {
  const unit = unitM(radiusM);
  const frames = fieldFrameMatrices(unit);
  const matrices = [...frames.mask, ...frames.rock];
  const offsets = [...MASK_OFFSETS, ...Array.from({ length: ROCK_OCTAVES }, () => [0, 0, 0] as const)];
  const cpuField = createTerrainFieldCpu(radiusM);
  const texture = createNoiseTexture();

  const altitudes = points.map((p) => Math.hypot(p.camera[0] + p.x[0], p.camera[1] + p.x[1], p.camera[2] + p.x[2]) - radiusM);
  const rows = points.map((p, row) => [
    [...p.camera, 0],
    [...p.x, altitudes[row]],
    ...matrices.map((m, i) => {
      const o = noiseOrigin(m, new Vector3(...offsets[i]), p.camera[0], p.camera[1], p.camera[2]);
      return [o.x, o.y, o.z, 0];
    }),
  ]);

  const result = await evaluateOnGpu(rows, (at) => {
    const frameNodes: NoiseFrameNodes[] = matrices.map((m, i) => ({ uMatrix: uniform(new Matrix3().copy(m)), uOrigin: at(2 + i).xyz }));
    const maskFrames = frameNodes.slice(0, 2);
    const rockFrames = frameNodes.slice(2);
    const camera = at(0).xyz;
    const x = at(1).xyz;
    const altitude = at(1).w;
    const field: FieldNodes = { noiseTexture: texture, camera, unit: float(unit), rockFrames, maskFrames };
    const up = camera.add(x).normalize();
    return vec4(
      sampleFrame(texture, maskFrames[0], x, true),
      canyonAt(texture, maskFrames, x, true),
      rockAt(texture, rockFrames, float(unit), x, up, altitude, float(0), true),
      densityAt(field, x, altitude, float(0), true),
    );
  });

  const gpu: Evaluated[] = points.map((_, i) => ({
    noise: result[i * 4], canyon: result[i * 4 + 1], rock: result[i * 4 + 2], density: result[i * 4 + 3],
  }));
  const bytes = generateNoiseBytes();
  const cpu: Evaluated[] = points.map((p) => {
    const body: V3 = [p.camera[0] + p.x[0], p.camera[1] + p.x[1], p.camera[2] + p.x[2]];
    const m = frames.mask[0].elements;
    const o = new Vector3(...MASK_OFFSETS[0]);
    const nx = (((m[0] * body[0] + m[3] * body[1] + m[6] * body[2] + o.x) % NOISE_PERIOD) + NOISE_PERIOD) % NOISE_PERIOD;
    const ny = (((m[1] * body[0] + m[4] * body[1] + m[7] * body[2] + o.y) % NOISE_PERIOD) + NOISE_PERIOD) % NOISE_PERIOD;
    const nz = (((m[2] * body[0] + m[5] * body[1] + m[8] * body[2] + o.z) % NOISE_PERIOD) + NOISE_PERIOD) % NOISE_PERIOD;
    return { noise: valueNoiseCpu(bytes, nx, ny, nz), canyon: cpuField.canyon(body), rock: cpuField.rock(body), density: cpuField.density(body) };
  });
  return { gpu, cpu, altitudes };
}

describe('planet shape terrain field: GPU / CPU parity', () => {
  for (const radiusM of BODY_RADII_M) {
    it(`matches the CPU twin on a ${radiusM / 1000} km body (camera-relative)`, async () => {
      const points = samplePoints(radiusM);
      const { gpu, cpu } = await evaluate(radiusM, points);
      const unit = unitM(radiusM);
      let worst = { noise: 0, canyon: 0, rock: 0, density: 0 };
      points.forEach((_, i) => {
        worst = {
          noise: Math.max(worst.noise, Math.abs(gpu[i].noise - cpu[i].noise)),
          canyon: Math.max(worst.canyon, Math.abs(gpu[i].canyon - cpu[i].canyon)),
          rock: Math.max(worst.rock, Math.abs(gpu[i].rock - cpu[i].rock)),
          density: Math.max(worst.density, Math.abs(gpu[i].density - cpu[i].density)),
        };
      });
      console.log(`field parity ${radiusM} m: worst |gpu-cpu| noise ${worst.noise.toExponential(2)} canyon ${worst.canyon.toExponential(2)} ` +
        `rock ${worst.rock.toExponential(2)} density ${worst.density.toExponential(2)} m (unit ${unit} m)`);
      expect(worst.noise).toBeLessThan(NOISE_TOLERANCE);
      expect(worst.canyon).toBeLessThan(MASK_TOLERANCE);
      expect(worst.rock).toBeLessThan(ROCK_TOLERANCE);
      expect(worst.density).toBeLessThan(unit * DENSITY_TOLERANCE_UNITS);
    });
  }
});

describe('planet shape terrain field: CPU twin', () => {
  const radiusM = 6_371_000;

  it('generates the same bytes every time, RGBA8 256 x 256', () => {
    const a = generateNoiseBytes();
    const b = generateNoiseBytes();
    expect(a.length).toBe(256 * 256 * 4);
    expect(a).toEqual(b);
    expect(a[3]).toBe(255);
  });

  it('is periodic in the noise period', () => {
    const bytes = generateNoiseBytes();
    for (const [x, y, z] of [[3.3, 7.9, 12.1], [100.5, 200.25, 0.75], [255.9, 0.1, 50.5]]) {
      const base = valueNoiseCpu(bytes, x, y, z);
      expect(valueNoiseCpu(bytes, x + NOISE_PERIOD, y, z)).toBeCloseTo(base, 12);
      expect(valueNoiseCpu(bytes, x, y + NOISE_PERIOD, z)).toBeCloseTo(base, 12);
      expect(valueNoiseCpu(bytes, x, y, z + NOISE_PERIOD)).toBeCloseTo(base, 12);
    }
  });

  it('keeps noise, canyon and rock in range and the field deterministic', () => {
    const field = createTerrainFieldCpu(radiusM);
    const again = createTerrainFieldCpu(radiusM);
    for (const p of samplePoints(radiusM)) {
      const body: V3 = [p.camera[0] + p.x[0], p.camera[1] + p.x[1], p.camera[2] + p.x[2]];
      expect(field.canyon(body)).toBeGreaterThanOrEqual(0);
      expect(field.canyon(body)).toBeLessThanOrEqual(1);
      expect(field.rock(body)).toBeGreaterThan(0);
      expect(field.rock(body)).toBeLessThan(0.875);
      expect(field.density(body)).toBe(again.density(body));
    }
  });

  it('is flat at the sphere on the pad and solid below it', () => {
    const field = createTerrainFieldCpu(radiusM);
    expect(field.groundHeightAt([0, 0, 1])).toBeCloseTo(0, 6);
    expect(field.isSolid([0, 0, radiusM - 1])).toBeTrue();
    expect(field.isSolid([0, 0, radiusM + 1])).toBeFalse();
  });

  it('lands groundHeightAt where the density is zero and the ground is solid below, open above', () => {
    for (const r of [20_000, radiusM]) {
      const field = createTerrainFieldCpu(r);
      const unit = field.unit;
      const directions: V3[] = [[0.3, 0.2, 0.93], [0.9, 0.1, 0.42], [-0.5, 0.7, 0.51], [0.1, -0.95, 0.29], [-0.8, -0.4, -0.45], [0.6, 0.6, -0.53]];
      for (const d of directions) {
        const length = Math.hypot(...d);
        const at = (altitude: number): V3 => [(d[0] / length) * (r + altitude), (d[1] / length) * (r + altitude), (d[2] / length) * (r + altitude)];
        const height = field.groundHeightAt(d);
        expect(height).toBeLessThanOrEqual(topAltitudeM(r) + 1e-6);
        expect(height).toBeGreaterThanOrEqual(bottomAltitudeM(r) - 1e-6);
        expect(Math.abs(field.density(at(height)))).toBeLessThan(unit * 1e-6);
        expect(field.isSolid(at(height - unit * 1e-4))).toBeTrue();
        // Outermost: nothing above is solid (sampled at the march step).
        for (let a = height + unit * 0.05; a <= topAltitudeM(r); a += unit * 0.05) expect(field.isSolid(at(a))).toBeFalse();
      }
    }
  });
});
