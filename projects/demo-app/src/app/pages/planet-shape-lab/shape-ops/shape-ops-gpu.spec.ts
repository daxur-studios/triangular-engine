/* eslint-disable @typescript-eslint/no-explicit-any */
import { Matrix3, Vector3 } from 'three';
import { float, normalize, uniform, vec4 } from 'three/tsl';
import { evaluateOnGpu } from '../../../../../../triangular-engine/planet-material/gpu-eval.testing';
import {
  BIOME_OFFSET, MASK_OFFSETS, ROCK_OCTAVES, bottomAltitudeM, densityAt, fieldFrameMatrices, noiseOrigin, topAltitudeM, unitM, type FieldNodes,
  type NoiseFrameNodes,
} from '../planet-shape-field';
import { createTerrainFieldCpu } from '../planet-shape-field-cpu';
import { shapeOpPreset } from '../planet-shape-edits';
import { createNoiseTexture } from '../planet-shape-noise';
import { compileShapeOps, type ShapeOp, type V3 } from './shape-op';
import { GPU_TILES_PER_FACE, createShapeOpTextures } from './shape-ops-gpu';

/**
 * GPU / CPU parity of the shape ops: the packed ops, applied in the shader through the op index, against
 * `compileShapeOps` (all ops, doubles) on the same input values. The input value is a synthetic field (altitude plus a
 * wobble), since the ops act on whatever value they are given.
 */

type P3 = [number, number, number];

/** A seeded generator (mulberry32), so failures repeat. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A local frame on the body: `at(east, north, altitude)` in units of `unit` (east and north as arcs). */
function frame(radiusM: number, base: V3): (east: number, north: number, altitude?: number) => P3 {
  const unit = unitM(radiusM);
  const length = Math.hypot(...base);
  const up: P3 = [base[0] / length, base[1] / length, base[2] / length];
  const helper: P3 = Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e: P3 = [helper[1] * up[2] - helper[2] * up[1], helper[2] * up[0] - helper[0] * up[2], helper[0] * up[1] - helper[1] * up[0]];
  const el = Math.hypot(...e);
  const east: P3 = [e[0] / el, e[1] / el, e[2] / el];
  const north: P3 = [up[1] * east[2] - up[2] * east[1], up[2] * east[0] - up[0] * east[2], up[0] * east[1] - up[1] * east[0]];
  return (de, dn, altitude = 0) => {
    const a = (de * unit) / radiusM;
    const b = (dn * unit) / radiusM;
    const d: P3 = [0, 1, 2].map((k) => up[k] + east[k] * a + north[k] * b) as P3;
    const dl = Math.hypot(...d);
    const r = radiusM + altitude * unit;
    return [(d[0] / dl) * r, (d[1] / dl) * r, (d[2] / dl) * r];
  };
}

/** One op of every shape and blend around `base`, sized in relief units. */
function opsAround(radiusM: number, base: V3): ShapeOp[] {
  const u = unitM(radiusM);
  const at = frame(radiusM, base);
  return [
    { id: 'pad', shape: { kind: 'disc', centre: at(-6, -6), radiusM: 3 * u, edgeM: u, heightM: 0.5 * u }, blend: { mode: 'set' }, fidelity: 'contact' },
    { id: 'peak', shape: { kind: 'cone', centre: at(4, 2), radiusM: 4 * u, heightM: 3 * u, edgeM: u, sharpness: 1.5 }, blend: { mode: 'add' } },
    { id: 'pit', shape: { kind: 'cone', centre: at(-3, 6), radiusM: 2 * u, heightM: -u }, blend: { mode: 'add' } },
    {
      id: 'crater', shape: { kind: 'crater', centre: at(7, -5), radiusM: 3 * u, depthM: u, rimHeightM: 0.5 * u, rimWidthM: u, edgeM: 0.5 * u },
      blend: { mode: 'add' },
    },
    {
      id: 'ridge', shape: { kind: 'path', points: [at(-9, 0), at(-2, 1), at(3, -3)], heightsM: [u, 2 * u, 0.5 * u], widthM: 2 * u, edgeM: u, profile: 'round' },
      blend: { mode: 'raise', smoothM: 0.5 * u },
    },
    {
      id: 'road', shape: { kind: 'path', points: [at(-8, -9), at(0, -7), at(8, -8)], heightsM: [0, 0.2 * u, -0.3 * u], widthM: 0.8 * u, edgeM: 0.4 * u },
      blend: { mode: 'lower', smoothM: 0.2 * u },
    },
    { id: 'soft', shape: { kind: 'disc', centre: at(0, 8), radiusM: 3 * u, edgeM: 2 * u }, blend: { mode: 'scale', factor: 0.3 } },
    { id: 'boulder', shape: { kind: 'sphere', centre: at(-5, 3, 0.5), radiusM: 0.8 * u }, blend: { mode: 'union', smoothM: 0.3 * u } },
    { id: 'tunnel', shape: { kind: 'tube', points: [at(2, 5, -0.5), at(5, 4, 0), at(8, 1, -0.3)], radiusM: 0.7 * u }, blend: { mode: 'subtract', smoothM: 0.2 * u } },
    { id: 'flat-road', shape: { kind: 'path', points: [at(-2, -2), at(6, 6)], heightsM: [0.3 * u, 0.3 * u], widthM: u, edgeM: 0.5 * u, profile: 'flat' }, blend: { mode: 'set' } },
    {
      id: 'graded-road', shape: { kind: 'path', points: [at(-9, 4), at(-1, 9)], heightsM: [-0.4 * u, 0.6 * u], widthM: 0.8 * u },
      blend: { mode: 'grade', slope: 1.5 }, fidelity: 'contact',
    },
    { id: 'graded-pad', shape: { kind: 'disc', centre: at(9, 9), radiusM: 1.5 * u, heightM: 0.4 * u }, blend: { mode: 'grade' } },
  ];
}

async function compare(radiusM: number, base: V3, cameraAltitudeUnits: number, seed: number): Promise<{ worst: number; changed: number; rows: number }> {
  const u = unitM(radiusM);
  const ops = opsAround(radiusM, base);
  const cpu = compileShapeOps(ops, radiusM);
  const gpu = createShapeOpTextures();
  const band = { bottomM: bottomAltitudeM(radiusM), topM: topAltitudeM(radiusM) };
  gpu.setOps(ops, radiusM, band);
  const at = frame(radiusM, base);
  const camera = at(-1, -1, cameraAltitudeUnits);
  gpu.setCamera(camera);
  const next = random(seed);
  let worst = 0;
  let changed = 0;
  let rows = 0;
  for (let batch = 0; batch < 4; batch++) {
    const points: { x: P3; altitude: number; value: number; p: P3 }[] = [];
    for (let i = 0; i < 120; i++) {
      const p = at(next() * 22 - 11, next() * 22 - 11, next() * 6 - 2.5);
      const altitude = Math.hypot(...p) - radiusM;
      const value = altitude + u * 0.6 * Math.sin(next() * 6.283);
      points.push({ x: [p[0] - camera[0], p[1] - camera[1], p[2] - camera[2]], altitude, value, p });
    }
    const result = await evaluateOnGpu(
      points.map((pt) => [[...camera, pt.altitude], [...pt.x, pt.value]]),
      (slot) => {
        const x = slot(1).xyz;
        const up = normalize(slot(0).xyz.add(x));
        return vec4(gpu.apply(slot(1).w, x, up, slot(0).w, slot(0).w.mul(0)), 0, 0, 0);
      },
    );
    points.forEach((pt, i) => {
      const expected = cpu.apply(pt.value, pt.p);
      worst = Math.max(worst, Math.abs(result[i * 4] - expected));
      if (Math.abs(expected - pt.value) > u * 0.05) changed++;
    });
    rows += points.length;
  }
  gpu.dispose();
  return { worst, changed, rows };
}

describe('shape ops on the GPU', () => {
  const cases: [number, V3, number][] = [
    [20_000, [0.3, 0.2, 0.93], 3],
    [600_000, [-0.5, 0.7, 0.51], 1],
    [6_371_000, [0.02, 0.01, 0.9997], 0.2],
    // Near a cube-face corner, where the tile lookup is most likely to disagree with the CPU index.
    [600_000, [1, 1, 1], 1],
  ];
  for (const [radiusM, base, cameraAltitude] of cases) {
    it(`match compileShapeOps on a ${radiusM / 1000} km body at [${base.join(', ')}]`, async () => {
      const u = unitM(radiusM);
      const { worst, changed, rows } = await compare(radiusM, base, cameraAltitude, Math.round(radiusM + base[0] * 1000));
      console.log(`shape ops gpu parity ${radiusM} m: worst |gpu-cpu| ${worst.toExponential(2)} m (unit ${u} m), ${changed}/${rows} values changed by the ops`);
      expect(worst).toBeLessThan(u * 2e-3);
      expect(changed).toBeGreaterThan(rows * 0.2);
    });
  }

  it('skips relaxed ops whose size is below the footprint, never contact ones', async () => {
    const radiusM = 600_000;
    const u = unitM(radiusM);
    const at = frame(radiusM, [0, 0, 1]);
    const ops: ShapeOp[] = [
      { id: 'small', shape: { kind: 'cone', centre: at(0, 0), radiusM: u, heightM: u }, blend: { mode: 'add' } },
      { id: 'kept', shape: { kind: 'disc', centre: at(0, 0), radiusM: u, heightM: 0.5 * u }, blend: { mode: 'add' }, fidelity: 'contact' },
    ];
    const gpu = createShapeOpTextures();
    gpu.setOps(ops, radiusM, { bottomM: bottomAltitudeM(radiusM), topM: topAltitudeM(radiusM) });
    const camera = at(0, 0, 1);
    gpu.setCamera(camera);
    const p = at(0.1, 0);
    const x = [p[0] - camera[0], p[1] - camera[1], p[2] - camera[2]];
    const altitude = Math.hypot(...p) - radiusM;
    const footprints = [0, 0.5 * u, 2 * u];
    const result = await evaluateOnGpu(footprints.map((f) => [[...camera, altitude], [...x, f]]), (slot) => {
      const xs = slot(1).xyz;
      return vec4(gpu.apply(slot(0).w, xs, normalize(slot(0).xyz.add(xs)), slot(0).w, slot(1).w), 0, 0, 0);
    });
    const cpu = compileShapeOps(ops, radiusM);
    footprints.forEach((f, i) => expect(result[i * 4]).toBeCloseTo(cpu.apply(altitude, p, f), 1));
    // At 2 units the cone is skipped: only the contact disc's half unit is left.
    expect(cpu.apply(altitude, p, 2 * u)).toBeCloseTo(altitude - 0.5 * u, 3);
    gpu.dispose();
  });

  it('reaches the nearest union shape exactly, past the tiles that list it, and ignores the other volume ops (and the CPU twin agrees)', async () => {
    const radiusM = 600_000;
    const u = unitM(radiusM);
    const ops = shapeOpPreset('landforms', radiusM);
    const gpu = createShapeOpTextures();
    gpu.setOps(ops, radiusM, { bottomM: bottomAltitudeM(radiusM), topM: topAltitudeM(radiusM) });
    const at = frame(radiusM, [0, 0, 1]);
    const camera = at(20, 0, 2);
    gpu.setCamera(camera);
    const unions = ops.filter((op) => op.blend.mode === 'union');
    const segment = (p: V3, a: readonly number[], b: readonly number[]): number => {
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
      const t = Math.min(1, Math.max(0, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)));
      return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
    };
    const exact = (p: V3): number => Math.min(...unions.map((op) => {
      const shape = op.shape;
      if (shape.kind === 'sphere') return Math.hypot(p[0] - shape.centre[0], p[1] - shape.centre[1], p[2] - shape.centre[2]) - shape.radiusM;
      if (shape.kind !== 'tube') throw new Error('union op is not a volume');
      return Math.min(...shape.points.slice(1).map((b, i) => segment(p, shape.points[i], b))) - shape.radiusM;
    }));
    const next = random(7);
    // Up to 60 units away: far outside the tiles of a 600 km body that list the arch.
    const points = Array.from({ length: 64 }, () => at(-40 + next() * 100, -30 + next() * 60, -2 + next() * 8));
    const result = await evaluateOnGpu(
      points.map((p) => [[p[0] - camera[0], p[1] - camera[1], p[2] - camera[2], 0]]),
      (slot) => vec4(gpu.reach(slot(0).xyz, float(0)), 0, 0, 0),
    );
    const cpu = compileShapeOps(ops, radiusM);
    points.forEach((p, i) => {
      expect(Math.abs(result[i * 4] - exact(p))).withContext(`point ${i}`).toBeLessThan(u * 1e-3);
      expect(cpu.reach(p)).withContext(`CPU, point ${i}`).toBeCloseTo(exact(p), 6);
    });
    gpu.dispose();
  });

  it('widens the march band by the ops and keeps the index resolution it was built with', () => {
    const radiusM = 600_000;
    const u = unitM(radiusM);
    const gpu = createShapeOpTextures();
    const base = { bottomM: bottomAltitudeM(radiusM), topM: topAltitudeM(radiusM) };
    gpu.setOps(opsAround(radiusM, [0, 0, 1]), radiusM, base);
    expect(gpu.band.topM).toBeGreaterThanOrEqual(base.topM + 3 * u - 1e-6);
    expect(gpu.band.bottomM).toBeLessThanOrEqual(base.bottomM);
    expect(gpu.index?.tilesPerFace).toBe(GPU_TILES_PER_FACE);
    expect(() => gpu.setOps([{ id: 'bad', shape: { kind: 'sphere', centre: [0, 0, 0], radiusM: 1 }, blend: { mode: 'union' } }], radiusM, base))
      .toThrowError(/body centre/);
    gpu.dispose();
  });

  it('give the terrain v2 density the CPU twin gives, landforms on a 600 km body (field and ops together)', async () => {
    const radiusM = 600_000;
    const u = unitM(radiusM);
    const ops = shapeOpPreset('landforms', radiusM);
    const cpu = createTerrainFieldCpu(radiusM);
    cpu.setShapeOps(ops);
    const plain = createTerrainFieldCpu(radiusM);
    const gpuOps = createShapeOpTextures();
    gpuOps.setOps(ops, radiusM, { bottomM: bottomAltitudeM(radiusM), topM: topAltitudeM(radiusM) });
    // East of the poses (+Z towards +X), where the landforms are.
    const at = (east: number, north: number, altitude = 0): P3 => {
      const a = (east * u) / radiusM;
      const b = (north * u) / radiusM;
      const r = radiusM + altitude * u;
      return [Math.sin(a) * Math.cos(b) * r, Math.sin(b) * r, Math.cos(a) * Math.cos(b) * r];
    };
    const camera = at(20, 0, 2);
    gpuOps.setCamera(camera);
    const frames = fieldFrameMatrices(u);
    const matrices = [...frames.mask, ...frames.rock, frames.biome];
    const offsets = [...MASK_OFFSETS, ...Array.from({ length: ROCK_OCTAVES }, () => [0, 0, 0] as const), BIOME_OFFSET];
    const frameNodes: NoiseFrameNodes[] = matrices.map((m, i) => ({
      uMatrix: uniform(new Matrix3().copy(m)), uOrigin: uniform(noiseOrigin(m, new Vector3(...offsets[i]), ...camera)),
    }));
    const field: FieldNodes = {
      noiseTexture: createNoiseTexture(), camera: uniform(new Vector3(...camera)), unit: float(u),
      maskFrames: frameNodes.slice(0, 2), rockFrames: frameNodes.slice(2, 2 + ROCK_OCTAVES),
      biome: { frame: frameNodes[2 + ROCK_OCTAVES], override: float(-1) }, shapeOps: gpuOps,
    };
    const next = random(55);
    const points = Array.from({ length: 160 }, () => at(8 + next() * 32, -10 + next() * 24, -3 + next() * 9));
    const result = await evaluateOnGpu(
      points.map((p) => [[p[0] - camera[0], p[1] - camera[1], p[2] - camera[2], Math.hypot(...p) - radiusM]]),
      (slot) => vec4(densityAt(field, slot(0).xyz, slot(0).w, float(0), true), 0, 0, 0),
    );
    let worst = 0;
    let changed = 0;
    points.forEach((p, i) => {
      worst = Math.max(worst, Math.abs(result[i * 4] - cpu.density(p)));
      if (Math.abs(cpu.density(p) - plain.density(p)) > u * 0.05) changed++;
    });
    console.log(`landforms field parity: worst |gpu-cpu| ${worst.toExponential(2)} m (unit ${u} m), ${changed}/${points.length} changed by the ops`);
    // The field's own tolerance (planet-shape-field.spec.ts): a hundredth of a unit.
    expect(worst).toBeLessThan(u * 0.01);
    expect(changed).toBeGreaterThan(points.length * 0.3);
    gpuOps.dispose();
  });
});
