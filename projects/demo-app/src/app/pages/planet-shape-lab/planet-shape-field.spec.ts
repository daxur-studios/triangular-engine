/* eslint-disable @typescript-eslint/no-explicit-any */
import { Matrix3, Vector3 } from 'three';
import { float, uniform, vec4 } from 'three/tsl';
import { evaluateOnGpu } from '../../../../../triangular-engine/planet-material/gpu-eval.testing';
import {
  BIOME_OFFSET, CANYON_BIOME, HILLS_BIOME, MASK_OFFSETS, ROCK_MEAN, ROCK_OCTAVES, biomeAt, bottomAltitudeM, canyonAt, densityAt, editBoundM, fieldFrameMatrices, noiseOrigin, padEdit, rayEditMask,
  NOISE_GRADIENT_MAX, rockAt, sampleFrame,
  terrainEditUniforms, topAltitudeM, unitM, warpLipschitzBound, type FieldNodes, type NoiseFrameNodes, type TerrainEdit,
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
  const matrices = [...frames.mask, ...frames.rock, frames.biome];
  const offsets = [...MASK_OFFSETS, ...Array.from({ length: ROCK_OCTAVES }, () => [0, 0, 0] as const), BIOME_OFFSET];
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
    const rockFrames = frameNodes.slice(2, 2 + ROCK_OCTAVES);
    const biomeFrame = frameNodes[2 + ROCK_OCTAVES];
    const camera = at(0).xyz;
    const x = at(1).xyz;
    const altitude = at(1).w;
    const field: FieldNodes = {
      noiseTexture: texture, camera, unit: float(unit), rockFrames, maskFrames, biome: { frame: biomeFrame, override: float(-1) },
    };
    const up = camera.add(x).normalize();
    return vec4(
      sampleFrame(texture, maskFrames[0], x, true),
      canyonAt(texture, maskFrames, x, true),
      rockAt(texture, rockFrames, float(unit), x, up, altitude, float(0), true, biomeAt(texture, biomeFrame, x, true)),
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

/** GPU density at camera-relative points `xs` for one camera, with `edits` packed for that camera. */
async function gpuDensity(radiusM: number, camera: V3, xs: V3[], edits: readonly TerrainEdit[], rockOverride = -1): Promise<number[]> {
  const unit = unitM(radiusM);
  const frames = fieldFrameMatrices(unit);
  const matrices = [...frames.mask, ...frames.rock, frames.biome];
  const offsets = [...MASK_OFFSETS, ...Array.from({ length: ROCK_OCTAVES }, () => [0, 0, 0] as const), BIOME_OFFSET];
  const texture = createNoiseTexture();
  const editUniforms = terrainEditUniforms();
  editUniforms.set(edits, camera, radiusM);
  const rows = xs.map((x) => [[...x, Math.hypot(camera[0] + x[0], camera[1] + x[1], camera[2] + x[2]) - radiusM]]);
  const result = await evaluateOnGpu(rows, (at) => {
    const frameNodes: NoiseFrameNodes[] = matrices.map((m, i) => {
      const o = noiseOrigin(m, new Vector3(...offsets[i]), camera[0], camera[1], camera[2]);
      return { uMatrix: uniform(new Matrix3().copy(m)), uOrigin: uniform(o) };
    });
    const field: FieldNodes = {
      noiseTexture: texture, camera: uniform(new Vector3(...camera)), unit: float(unit),
      maskFrames: frameNodes.slice(0, 2), rockFrames: frameNodes.slice(2, 2 + ROCK_OCTAVES), edits: editUniforms,
      biome: { frame: frameNodes[2 + ROCK_OCTAVES], override: float(-1) }, rockOverride: float(rockOverride),
    };
    return vec4(densityAt(field, at(0).xyz, at(0).w, float(0), true), 0, 0, 0);
  });
  return xs.map((_, i) => result[i * 4]);
}

/** Body-relative point at `altitudeM` above the unit direction `d` (need not be unit). */
function above(radiusM: number, d: V3, altitudeM: number): V3 {
  const length = Math.hypot(...d);
  const r = radiusM + altitudeM;
  return [(d[0] / length) * r, (d[1] / length) * r, (d[2] / length) * r];
}

/** One edit of each kind around a camera direction, sized in relief units, with points inside, on the rims and outside. */
function editCase(radiusM: number, d: V3): { camera: V3; edits: TerrainEdit[]; xs: V3[] } {
  const unit = unitM(radiusM);
  const camera = above(radiusM, d, unit * 2);
  const side = (k: number): V3 => {
    const n = Math.hypot(...d);
    const east: V3 = [d[2] / n, 0, -d[0] / n];
    const length = Math.hypot(...east) || 1;
    return [(east[0] / length) * k, (east[1] / length) * k, (east[2] / length) * k];
  };
  const shifted = (k: number): V3 => {
    const s = side(k);
    const ground = above(radiusM, d, 0);
    return [ground[0] + s[0], ground[1] + s[1], ground[2] + s[2]];
  };
  const edits: TerrainEdit[] = [
    { kind: 'flatten', centre: shifted(0), radiusM: unit * 2, edgeM: unit * 2, heightM: unit * 0.5 },
    { kind: 'soften', centre: shifted(unit * 6), radiusM: unit * 2, edgeM: unit * 2, strength: 0.2 },
    { kind: 'carve', centre: shifted(-unit * 6), radiusM: unit * 1.5, edgeM: unit * 0.3 },
  ];
  const xs: V3[] = [];
  for (let k = -10; k <= 10; k++) {
    for (const altitude of [-2, 0, 0.5, 1.5]) {
      const p = shifted(unit * k);
      const up = above(radiusM, p, 0);
      const n = Math.hypot(...p);
      const q: V3 = [up[0] + (p[0] / n) * unit * altitude, up[1] + (p[1] / n) * unit * altitude, up[2] + (p[2] / n) * unit * altitude];
      xs.push([q[0] - camera[0], q[1] - camera[1], q[2] - camera[2]]);
    }
  }
  return { camera, edits, xs };
}

describe('planet shape terrain field: edits', () => {
  for (const radiusM of [20_000, 6_371_000]) {
    it(`match the CPU twin on a ${radiusM / 1000} km body (flatten, soften, carve)`, async () => {
      const unit = unitM(radiusM);
      const bytes = generateNoiseBytes();
      let worst = 0;
      let changed = 0;
      for (const d of [[0.3, 0.2, 0.93], [-0.5, 0.7, 0.51], [0.02, 0.01, 0.9997]] as V3[]) {
        const { camera, edits, xs } = editCase(radiusM, d);
        const gpu = await gpuDensity(radiusM, camera, xs, edits);
        const cpuField = createTerrainFieldCpu(radiusM, bytes, edits);
        const plain = createTerrainFieldCpu(radiusM, bytes, []);
        xs.forEach((x, i) => {
          const body: V3 = [camera[0] + x[0], camera[1] + x[1], camera[2] + x[2]];
          worst = Math.max(worst, Math.abs(gpu[i] - cpuField.density(body)));
          if (Math.abs(cpuField.density(body) - plain.density(body)) > unit * 0.1) changed++;
        });
      }
      console.log(`edit parity ${radiusM} m: worst |gpu-cpu| density ${worst.toExponential(2)} m (unit ${unit} m), ${changed} points changed by the edits`);
      expect(worst).toBeLessThan(unit * DENSITY_TOLERANCE_UNITS);
      expect(changed).toBeGreaterThan(20);
    });
  }

  const radiusM = 600_000;
  const unit = unitM(radiusM);
  const d: V3 = [0.3, 0.2, 0.93];
  const centre = above(radiusM, d, 0);

  it('flatten levels the ground at its height inside the disc and leaves it alone outside', () => {
    const plain = createTerrainFieldCpu(radiusM, undefined, []);
    const field = createTerrainFieldCpu(radiusM, undefined, [{ kind: 'flatten', centre, radiusM: unit * 3, edgeM: unit, heightM: unit * 0.4 }]);
    expect(field.groundHeightAt(d)).toBeCloseTo(unit * 0.4, 3);
    const far: V3 = [0.32, 0.2, 0.93];
    expect(field.groundHeightAt(far)).toBe(plain.groundHeightAt(far));
  });

  it('soften keeps its share of the relief', () => {
    const plain = createTerrainFieldCpu(radiusM, undefined, []);
    const field = createTerrainFieldCpu(radiusM, undefined, [{ kind: 'soften', centre, radiusM: unit * 3, edgeM: unit, strength: 0.25 }]);
    for (const altitude of [-unit, 0, unit]) {
      const p = above(radiusM, d, altitude);
      expect(field.density(p) - altitude).toBeCloseTo((plain.density(p) - altitude) * 0.25, 6);
    }
  });

  it('carve opens a hole in the rock and the pad stays the default', () => {
    const deep = above(radiusM, d, -unit * 3);
    const field = createTerrainFieldCpu(radiusM, undefined, [{ kind: 'carve', centre: deep, radiusM: unit, edgeM: unit * 0.1 }]);
    expect(createTerrainFieldCpu(radiusM, undefined, []).isSolid(deep)).toBeTrue();
    expect(field.isSolid(deep)).toBeFalse();
    expect(field.density(deep)).toBeCloseTo(unit, 0);
    expect(createTerrainFieldCpu(radiusM).edits).toEqual([padEdit(radiusM)]);
    expect(() => field.setEdits(Array.from({ length: 9 }, () => padEdit(radiusM)))).toThrowError(/At most 8/);
  });

  it('leave solidity alone outside their bounds (what the per-ray mask relies on)', () => {
    const edits: TerrainEdit[] = [
      { kind: 'flatten', centre, radiusM: unit * 2, edgeM: unit, heightM: unit * 0.5 },
      { kind: 'soften', centre, radiusM: unit * 2, edgeM: unit, strength: 0.1 },
      { kind: 'carve', centre: above(radiusM, d, -unit), radiusM: unit, edgeM: unit * 0.3 },
    ];
    const plain = createTerrainFieldCpu(radiusM, undefined, []);
    for (const edit of edits) {
      const field = createTerrainFieldCpu(radiusM, undefined, [edit]);
      const bound = editBoundM(edit, radiusM);
      let checked = 0;
      for (let k = 0; k < 400; k++) {
        // Points just outside the bound, across the air band.
        const angle = k * 2.399;
        const altitude = bottomAltitudeM(radiusM) + ((k * 0.618) % 1) * (topAltitudeM(radiusM) - bottomAltitudeM(radiusM));
        const n = Math.hypot(...d);
        const east: V3 = [d[2] / n, 0, -d[0] / n];
        const el = Math.hypot(...east);
        const north: V3 = [(d[1] / n) * east[2] / el, (d[2] / n) * east[0] / el - (d[0] / n) * east[2] / el, -(d[1] / n) * east[0] / el];
        const reach = bound * 1.001;
        const p0 = above(radiusM, d, altitude);
        const p: V3 = [
          p0[0] + (east[0] / el) * Math.cos(angle) * reach + north[0] * Math.sin(angle) * reach,
          p0[1] + (east[1] / el) * Math.cos(angle) * reach + north[1] * Math.sin(angle) * reach,
          p0[2] + (east[2] / el) * Math.cos(angle) * reach + north[2] * Math.sin(angle) * reach,
        ];
        const q = above(radiusM, p, altitude);
        if (Math.hypot(q[0] - edit.centre[0], q[1] - edit.centre[1], q[2] - edit.centre[2]) < bound) continue;
        expect(field.isSolid(q)).toBe(plain.isSolid(q));
        checked++;
      }
      expect(checked).toBeGreaterThan(300);
    }
  });

  it('select on the GPU the edits a ray passes near', async () => {
    const camera = above(radiusM, d, unit * 2);
    const near: TerrainEdit = { kind: 'carve', centre: above(radiusM, d, -unit), radiusM: unit, edgeM: unit * 0.2 };
    const far: TerrainEdit = { kind: 'flatten', centre: above(radiusM, [0.5, 0.2, 0.84], 0), radiusM: unit, edgeM: unit };
    const editUniforms = terrainEditUniforms();
    editUniforms.set([near, far], camera, radiusM);
    const n = Math.hypot(...d);
    const down: V3 = [-d[0] / n, -d[1] / n, -d[2] / n];
    const sideways: V3 = [d[2] / n, 0, -d[0] / n];
    const result = await evaluateOnGpu([[[...down, 0]], [[...sideways, 0]]], (at) =>
      vec4(float(rayEditMask(editUniforms.a, editUniforms.bound, editUniforms.count, at(0).xyz.normalize(), float(0), float(unit * 20))), 0, 0, 0));
    expect(result[0]).toBe(1);
    expect(result[4]).toBe(0);
  });
});

describe('planet shape terrain field: biomes', () => {
  const radiusM = 600_000;

  it('keeps every biome inside the canyon biome band the march encloses', () => {
    for (const biome of [CANYON_BIOME, HILLS_BIOME]) {
      expect(biome.canyonDepth).toBeLessThanOrEqual(CANYON_BIOME.canyonDepth);
      expect(biome.rockAmplitude).toBeLessThanOrEqual(CANYON_BIOME.rockAmplitude);
      expect(biome.stretch).toBeGreaterThanOrEqual(1);
      for (const c of biome.octaveContrast) expect(c).toBeGreaterThanOrEqual(0);
    }
  });

  it('blends both biomes over the body, and the override makes one everywhere', () => {
    const field = createTerrainFieldCpu(radiusM);
    let canyons = 0;
    let hills = 0;
    for (let k = 0; k < 400; k++) {
      // A spiral of directions over the sphere.
      const z = 1 - (2 * (k + 0.5)) / 400;
      const r = Math.sqrt(1 - z * z);
      const angle = k * 2.399963;
      const m = field.biome([r * Math.cos(angle) * radiusM, r * Math.sin(angle) * radiusM, z * radiusM]);
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(1);
      if (m < 0.05) canyons++;
      if (m > 0.95) hills++;
    }
    expect(canyons).toBeGreaterThan(80);
    expect(hills).toBeGreaterThan(80);
    field.biomeOverride = 1;
    expect(field.biome([radiusM, 0, 0])).toBe(1);
  });

  it('has no canyons in the hills biome', () => {
    const field = createTerrainFieldCpu(radiusM, undefined, [], 1, 0);
    const unit = field.unit;
    for (const d of [[0.3, 0.2, 0.93], [-0.5, 0.7, 0.51], [0.9, 0.1, 0.42]] as V3[]) {
      const p = above(radiusM, d, unit * 0.3);
      expect(field.density(p)).toBeCloseTo(unit * 0.3 + (field.rock(p) - ROCK_MEAN) * HILLS_BIOME.rockAmplitude * unit, 6);
    }
  });
});

/** Deterministic pseudo-random numbers in [0, 1). */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe('planet shape terrain field: grounded rock', () => {
  it('matches the CPU twin on the GPU when grounded or half grounded, three body sizes', async () => {
    for (const radiusM of BODY_RADII_M) {
      const unit = unitM(radiusM);
      const bytes = generateNoiseBytes();
      const points = samplePoints(radiusM);
      for (const share of [1, 0.5]) {
        const cpu = createTerrainFieldCpu(radiusM, bytes, [], undefined, share);
        let worst = 0;
        // Samples come four to a camera, in order.
        for (let first = 0; first < points.length; first += 4) {
          const group = points.slice(first, first + 4);
          const gpu = await gpuDensity(radiusM, group[0].camera, group.map((p) => p.x), [], share);
          group.forEach((p, i) => {
            const body: V3 = [p.camera[0] + p.x[0], p.camera[1] + p.x[1], p.camera[2] + p.x[2]];
            worst = Math.max(worst, Math.abs(gpu[i] - cpu.density(body)));
          });
        }
        console.log(`grounded parity ${radiusM} m, share ${share}: worst |gpu-cpu| density ${worst.toExponential(2)} m (unit ${unit} m)`);
        expect(worst).toBeLessThan(unit * DENSITY_TOLERANCE_UNITS);
      }
    }
  }, 120_000);

  it('keeps each biome its own mode unless overridden: canyons wild, hills grounded', () => {
    const field = createTerrainFieldCpu(600_000);
    expect(CANYON_BIOME.grounded).toBe(0);
    expect(HILLS_BIOME.grounded).toBe(1);
    field.biomeOverride = 0;
    expect(field.grounded([600_000, 0, 0])).toBe(0);
    field.biomeOverride = 1;
    expect(field.grounded([600_000, 0, 0])).toBe(1);
    field.groundedOverride = 0;
    expect(field.grounded([600_000, 0, 0])).toBe(0);
  });

  it('has a noise gradient below the constant the warp bound uses', () => {
    const bytes = generateNoiseBytes();
    const next = lcg(7);
    const h = 1e-4;
    let worst = 0;
    for (let k = 0; k < 20_000; k++) {
      const x = next() * 200;
      const y = next() * 200;
      const z = next() * 200;
      const gx = (valueNoiseCpu(bytes, x + h, y, z) - valueNoiseCpu(bytes, x - h, y, z)) / (2 * h);
      const gy = (valueNoiseCpu(bytes, x, y + h, z) - valueNoiseCpu(bytes, x, y - h, z)) / (2 * h);
      const gz = (valueNoiseCpu(bytes, x, y, z + h) - valueNoiseCpu(bytes, x, y, z - h)) / (2 * h);
      worst = Math.max(worst, Math.hypot(gx, gy, gz));
    }
    console.log(`value noise: largest |grad| ${worst.toFixed(3)} per lattice cell (bound ${NOISE_GRADIENT_MAX})`);
    expect(worst).toBeLessThan(NOISE_GRADIENT_MAX);
  });

  for (const radiusM of [20_000, 600_000, 6_371_000]) {
    it(`warps with a gradient below 1 on a ${radiusM / 1000} km body (finite differences)`, () => {
      const field = createTerrainFieldCpu(radiusM);
      const unit = field.unit;
      const h = unit * 1e-3;
      const next = lcg(radiusM);
      const jacobian = (p: V3): number[][] => {
        const columns = [0, 1, 2].map((axis) => {
          const hi: V3 = [...p];
          const lo: V3 = [...p];
          hi[axis] += h;
          lo[axis] -= h;
          const a = field.warp(hi);
          const b = field.warp(lo);
          return [(a[0] - b[0]) / (2 * h), (a[1] - b[1]) / (2 * h), (a[2] - b[2]) / (2 * h)];
        });
        return [0, 1, 2].map((row) => [columns[0][row], columns[1][row], columns[2][row]]);
      };
      /** Spectral norm by power iteration on J^T J. */
      const norm = (j: number[][]): number => {
        let v = [0.577, 0.577, 0.577];
        let value = 0;
        for (let i = 0; i < 40; i++) {
          const jv = j.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
          const w = [0, 1, 2].map((c) => j[0][c] * jv[0] + j[1][c] * jv[1] + j[2][c] * jv[2]);
          const length = Math.hypot(...w);
          if (length === 0) return 0;
          value = Math.sqrt(length);
          v = w.map((x) => x / length);
        }
        return value;
      };
      let worst = 0;
      let largestWarp = 0;
      for (let k = 0; k < 1500; k++) {
        const d: V3 = [next() - 0.5, next() - 0.5, next() - 0.5];
        const p = above(radiusM, d, unit * (next() * 10 - 8));
        const q: V3 = [p[0] + (next() - 0.5) * unit * 40, p[1] + (next() - 0.5) * unit * 40, p[2] + (next() - 0.5) * unit * 40];
        worst = Math.max(worst, norm(jacobian(q)));
        largestWarp = Math.max(largestWarp, Math.hypot(...field.warp(q)) / unit);
      }
      console.log(`warp ${radiusM} m: largest ||Dw|| ${worst.toFixed(3)} (proven bound ${warpLipschitzBound().toFixed(3)}), largest |w| ${largestWarp.toFixed(2)} units`);
      expect(warpLipschitzBound()).toBeLessThan(0.7);
      expect(worst).toBeLessThan(warpLipschitzBound());
      expect(worst).toBeGreaterThan(0.05);
    });
  }

  /**
   * Solid voxels of a block (n x n x nz, 6 units wide, the whole band tall) not reachable from its bottom layer. Yields to
   * the browser every few layers: a block is a few seconds of CPU field, longer than Karma's ping timeout.
   */
  async function unreachedSolid(
    field: ReturnType<typeof createTerrainFieldCpu>, d: V3, nx: number, nz: number,
  ): Promise<{ solid: number; unreached: number; bottomSolid: boolean }> {
    const unit = field.unit;
    const radiusM = field.radiusM;
    const width = 6 * unit;
    const bottom = bottomAltitudeM(radiusM) - unit * 0.5;
    const top = topAltitudeM(radiusM) + unit * 0.5;
    const centre = above(radiusM, d, 0);
    const n = Math.hypot(...centre);
    const up: V3 = [centre[0] / n, centre[1] / n, centre[2] / n];
    const east0: V3 = [up[2], 0, -up[0]];
    const el = Math.hypot(...east0);
    const east: V3 = [east0[0] / el, east0[1] / el, east0[2] / el];
    const north: V3 = [up[1] * east[2] - up[2] * east[1], up[2] * east[0] - up[0] * east[2], up[0] * east[1] - up[1] * east[0]];
    const solid = new Uint8Array(nx * nx * nz);
    let count = 0;
    for (let k = 0; k < nz; k++) {
      if (k % 4 === 0) await new Promise((resolve) => setTimeout(resolve));
      const z = bottom + ((top - bottom) * k) / (nz - 1);
      for (let j = 0; j < nx; j++) {
        const y = (j / (nx - 1) - 0.5) * width;
        for (let i = 0; i < nx; i++) {
          const x = (i / (nx - 1) - 0.5) * width;
          const p: V3 = [
            centre[0] + east[0] * x + north[0] * y + up[0] * z,
            centre[1] + east[1] * x + north[1] * y + up[1] * z,
            centre[2] + east[2] * x + north[2] * y + up[2] * z,
          ];
          if (field.isSolid(p)) {
            solid[(k * nx + j) * nx + i] = 1;
            count++;
          }
        }
      }
    }
    const reached = new Uint8Array(solid.length);
    const stack: number[] = [];
    let bottomSolid = true;
    for (let c = 0; c < nx * nx; c++) {
      if (solid[c]) {
        reached[c] = 1;
        stack.push(c);
      } else bottomSolid = false;
    }
    while (stack.length) {
      const c = stack.pop()!;
      const i = c % nx;
      const j = Math.floor(c / nx) % nx;
      const k = Math.floor(c / (nx * nx));
      const visit = (ni: number, nj: number, nk: number): void => {
        if (ni < 0 || nj < 0 || nk < 0 || ni >= nx || nj >= nx || nk >= nz) return;
        const id = (nk * nx + nj) * nx + ni;
        if (solid[id] && !reached[id]) {
          reached[id] = 1;
          stack.push(id);
        }
      };
      visit(i - 1, j, k); visit(i + 1, j, k); visit(i, j - 1, k); visit(i, j + 1, k); visit(i, j, k - 1); visit(i, j, k + 1);
    }
    let reachedCount = 0;
    for (const r of reached) reachedCount += r;
    return { solid: count, unreached: count - reachedCount, bottomSolid };
  }

  it('has no floating rock when grounded, and wild rock does float (the check has teeth)', async () => {
    const radiusM = 600_000;
    const bytes = generateNoiseBytes();
    const next = lcg(2026);
    const spots: V3[] = Array.from({ length: 12 }, () => [next() - 0.5, next() - 0.5, next() - 0.2]);
    let wildUnreached = 0;
    for (const biome of [0, 1]) {
      for (const d of spots) {
        const grounded = await unreachedSolid(createTerrainFieldCpu(radiusM, bytes, [], biome, 1), d, 48, 96);
        const wild = await unreachedSolid(createTerrainFieldCpu(radiusM, bytes, [], biome, 0), d, 48, 96);
        console.log(`floaters, biome ${biome}, ${d.map((x) => x.toFixed(2))}: grounded ${grounded.unreached} of ${grounded.solid} solid voxels unreached, wild ${wild.unreached} of ${wild.solid}`);
        expect(grounded.bottomSolid).toBeTrue();
        expect(wild.bottomSolid).toBeTrue();
        expect(grounded.solid).toBeGreaterThan(48 * 48 * 8);
        expect(grounded.unreached).toBe(0);
        wildUnreached += wild.unreached;
      }
    }
    expect(wildUnreached).toBeGreaterThan(0);
  }, 600_000);
});
