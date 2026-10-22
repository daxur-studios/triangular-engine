import { BLOCK_CELLS, BLOCK_CORNERS, BLOCK_SAMPLES, gridIndex, type DensityBlockSpec, type Vec3 } from './block-grid';
import { ColliderBlockWorkerPool, meshDensityBlockInWorker, sampleAndMeshInWorker, sampleDensityBlockInWorker } from './block-worker-pool';
import { DIRECTIONS, MODES, RADIUS_M, VOXEL_M, cpuGrid, crossesSurface, surfaceBlock } from './block-fixtures';
import { createGpuDensityBlockGenerator, type GpuDensityBlockGenerator } from './gpu-density-block';
import { meshDensityBlock, type SurfaceNetsMesh } from './surface-nets';
import { unitM } from '../planet-shape-field';

/**
 * Plan 055 D2: can collider data for terrain with overhangs be made fast enough. Correctness first (surface nets,
 * GPU against the CPU twin), then timings. Timings from headless or software-rendered runs are indicative only.
 */

/** Same density tolerance as the field parity specs: a hundredth of the relief unit. */
const DENSITY_TOLERANCE_M = unitM(RADIUS_M) * 0.01;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function sphereGrid(centre: Vec3, radius: number): Float32Array {
  const grid = new Float32Array(BLOCK_SAMPLES);
  for (let k = 0; k < BLOCK_CORNERS; k++) {
    for (let j = 0; j < BLOCK_CORNERS; j++) {
      for (let i = 0; i < BLOCK_CORNERS; i++) grid[gridIndex(i, j, k)] = Math.hypot(i - centre[0], j - centre[1], k - centre[2]) - radius;
    }
  }
  return grid;
}

function torusGrid(centre: Vec3, major: number, minor: number): Float32Array {
  const grid = new Float32Array(BLOCK_SAMPLES);
  for (let k = 0; k < BLOCK_CORNERS; k++) {
    for (let j = 0; j < BLOCK_CORNERS; j++) {
      for (let i = 0; i < BLOCK_CORNERS; i++) {
        const q = Math.hypot(i - centre[0], j - centre[1]) - major;
        grid[gridIndex(i, j, k)] = Math.hypot(q, k - centre[2]) - minor;
      }
    }
  }
  return grid;
}

/** Edge use counts of a triangle list, the signed volume, and the vertices used. */
function topology(mesh: SurfaceNetsMesh): { edges: Map<string, number>; directed: Map<string, number>; volume: number; used: number } {
  const edges = new Map<string, number>();
  const directed = new Map<string, number>();
  const used = new Set<number>();
  let volume = 0;
  const p = mesh.positions;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]];
    used.add(a); used.add(b); used.add(c);
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = u < v ? `${u}-${v}` : `${v}-${u}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
      directed.set(`${u}>${v}`, (directed.get(`${u}>${v}`) ?? 0) + 1);
    }
    // Signed tetrahedron volume against the origin.
    volume += (p[3 * a] * (p[3 * b + 1] * p[3 * c + 2] - p[3 * b + 2] * p[3 * c + 1])
      - p[3 * a + 1] * (p[3 * b] * p[3 * c + 2] - p[3 * b + 2] * p[3 * c])
      + p[3 * a + 2] * (p[3 * b] * p[3 * c + 1] - p[3 * b + 1] * p[3 * c])) / 6;
  }
  return { edges, directed, volume, used: used.size };
}

describe('collider blocks: surface nets', () => {
  const expectWatertight = (mesh: SurfaceNetsMesh, genus: number): void => {
    const { edges, directed, used } = topology(mesh);
    // Every edge is shared by exactly two triangles, once in each direction: closed, manifold and consistently wound.
    for (const [key, count] of edges) expect(count).withContext(`edge ${key}`).toBe(2);
    for (const [key, count] of directed) expect(count).withContext(`directed ${key}`).toBe(1);
    expect(used).toBe(mesh.positions.length / 3);
    const faces = mesh.indices.length / 3;
    expect(used - edges.size + faces).withContext('Euler characteristic').toBe(2 - 2 * genus);
  };

  it('meshes an analytic sphere watertight, on the sphere, with outward normals', () => {
    const centre: Vec3 = [16.3, 15.7, 16.1];
    const radius = 9.5;
    const mesh = meshDensityBlock(sphereGrid(centre, radius));
    expect(mesh.indices.length).toBeGreaterThan(300);
    expectWatertight(mesh, 0);
    let worst = 0;
    for (let v = 0; v < mesh.positions.length; v += 3) {
      worst = Math.max(worst, Math.abs(Math.hypot(mesh.positions[v] - centre[0], mesh.positions[v + 1] - centre[1], mesh.positions[v + 2] - centre[2]) - radius));
    }
    expect(worst).toBeLessThan(0.1);
    // Positive volume relative to the centre means the triangles face away from the rock.
    const shifted = Float32Array.from(mesh.positions, (value, i) => value - centre[i % 3]);
    const volume = topology({ positions: shifted, indices: mesh.indices }).volume;
    expect(volume).toBeGreaterThan(0.95 * (4 / 3) * Math.PI * radius ** 3);
    expect(volume).toBeLessThan(1.05 * (4 / 3) * Math.PI * radius ** 3);
  });

  it('meshes a torus (genus 1) and a sphere with a different voxel size', () => {
    expectWatertight(meshDensityBlock(torusGrid([16.2, 15.8, 16.4], 9, 3.2)), 1);
    const mesh = meshDensityBlock(sphereGrid([16, 16, 16], 8.4), 0.5);
    expectWatertight(mesh, 0);
    expect(Math.max(...mesh.positions)).toBeLessThan(BLOCK_CELLS * 0.5);
  });

  it('is empty for an all-outside grid and open (never closed wrongly) when the surface leaves the block', () => {
    expect(meshDensityBlock(new Float32Array(BLOCK_SAMPLES).fill(1)).indices.length).toBe(0);
    const half = sphereGrid([16, 16, 0], 10);
    const mesh = meshDensityBlock(half);
    expect(mesh.indices.length).toBeGreaterThan(0);
    const { edges } = topology(mesh);
    const open = [...edges.values()].filter((count) => count === 1).length;
    expect(open).toBeGreaterThan(0);
    for (const count of edges.values()) expect(count).toBeLessThanOrEqual(2);
  });
});

describe('collider blocks: CPU density in workers', () => {
  let pool: ColliderBlockWorkerPool;
  beforeAll(() => { pool = new ColliderBlockWorkerPool(2); });
  afterAll(() => pool.dispose());

  it('gives the same grid as the main thread, and the same mesh from sample+mesh as from the two steps', async () => {
    const spec = surfaceBlock(DIRECTIONS[0]);
    const reference = cpuGrid(spec);
    expect(crossesSurface(reference)).toBeTrue();
    const { grid } = await sampleDensityBlockInWorker(pool, spec);
    expect(grid.length).toBe(BLOCK_SAMPLES);
    expect(grid).toEqual(reference);
    const direct = meshDensityBlock(reference, spec.voxelM);
    const viaWorker = (await meshDensityBlockInWorker(pool, grid, spec.voxelM)).mesh;
    expect(viaWorker.indices).toEqual(direct.indices);
    expect(viaWorker.positions).toEqual(direct.positions);
    const both = (await sampleAndMeshInWorker(pool, spec)).mesh;
    expect(both.indices).toEqual(direct.indices);
  }, 60_000);
});

describe('collider blocks: GPU density against the CPU twin', () => {
  let generator: GpuDensityBlockGenerator | null = null;
  beforeAll(async () => {
    try {
      generator = await createGpuDensityBlockGenerator(RADIUS_M);
    } catch (error) {
      console.warn('D2 collider blocks: GPU generator failed to start', error);
    }
  }, 60_000);
  afterAll(() => generator?.dispose());

  async function fetchOne(spec: DensityBlockSpec, frame: number): Promise<{ grid: Float32Array; roundTripMs: number }> {
    expect(generator!.request(frame, spec, frame)).toBeTrue();
    for (let wait = 0; wait < 2000; wait++) {
      const [result] = generator!.poll(frame + 1);
      if (result) return result;
      await sleep(1);
    }
    throw new Error('GPU block did not arrive');
  }

  it('matches the CPU twin block for block, with and without an edit', async () => {
    if (!generator) {
      pending('WebGPU is not available in this browser');
      return;
    }
    console.log(`D2 gpu adapter: ${generator.adapter}`);
    const cases: DensityBlockSpec[] = DIRECTIONS.map((d) => surfaceBlock(d));
    const base = surfaceBlock(DIRECTIONS[1]);
    const mid = base.origin.map((o) => o + 32) as Vec3;
    cases.push({ ...base, edits: [{ kind: 'carve', centre: mid, radiusM: 12, edgeM: 3 }] });
    let frame = 1;
    let worst = 0;
    for (const spec of cases) {
      const cpu = cpuGrid(spec);
      expect(crossesSurface(cpu)).toBeTrue();
      const { grid } = await fetchOne(spec, frame++);
      expect(grid.length).toBe(BLOCK_SAMPLES);
      let blockWorst = 0;
      let flips = 0;
      for (let i = 0; i < BLOCK_SAMPLES; i++) {
        blockWorst = Math.max(blockWorst, Math.abs(grid[i] - cpu[i]));
        if (cpu[i] < 0 !== grid[i] < 0) flips++;
      }
      worst = Math.max(worst, blockWorst);
      console.log(`D2 gpu/cpu parity: worst |gpu-cpu| ${blockWorst.toExponential(2)} m (tolerance ${DENSITY_TOLERANCE_M} m), ${flips} sign flips of ${BLOCK_SAMPLES}`);
      expect(blockWorst).toBeLessThan(DENSITY_TOLERANCE_M);
    }
    // The edit block differs from the plain one, so the edit path ran on the GPU.
    const plain = (await fetchOne(base, frame++)).grid;
    const edited = (await fetchOne(cases[cases.length - 1], frame++)).grid;
    expect(plain.some((d, i) => Math.abs(d - edited[i]) > 1)).toBeTrue();
    expect(worst).toBeLessThan(DENSITY_TOLERANCE_M);
  }, 120_000);

  it('meshes the GPU block to the same surface as the CPU block', async () => {
    if (!generator) {
      pending('WebGPU is not available in this browser');
      return;
    }
    const spec = surfaceBlock(DIRECTIONS[2]);
    const gpuMesh = meshDensityBlock((await fetchOne(spec, 1)).grid, spec.voxelM);
    const cpuMesh = meshDensityBlock(cpuGrid(spec), spec.voxelM);
    expect(gpuMesh.indices.length).toBeGreaterThan(0);
    // Same sign pattern almost everywhere, so the vertex and triangle counts agree to a few cells.
    expect(Math.abs(gpuMesh.positions.length - cpuMesh.positions.length) / cpuMesh.positions.length).toBeLessThan(0.02);
  }, 60_000);
});

describe('collider blocks: timings (indicative only: headless, possibly a software adapter)', () => {
  const stats = (values: number[]): string => {
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return `mean ${mean.toFixed(2)} p50 ${sorted[Math.floor(sorted.length / 2)].toFixed(2)} max ${sorted[sorted.length - 1].toFixed(2)} ms (n=${values.length})`;
  };

  it('GPU dispatch + readback per block', async () => {
    const generator = await createGpuDensityBlockGenerator(RADIUS_M, { slots: 8 });
    if (!generator) {
      pending('WebGPU is not available in this browser');
      return;
    }
    try {
      let frame = 1;
      const one = async (spec: DensityBlockSpec): Promise<{ roundTripMs: number; submitMs: number }> => {
        generator.request(frame, spec, frame);
        for (;;) {
          const [result] = generator.poll(++frame);
          if (result) return result;
          await sleep(0);
        }
      };
      for (const mode of MODES) {
      const specs = DIRECTIONS.map((d) => ({ ...surfaceBlock(d), biomeOverride: mode.biomeOverride, groundedOverride: mode.groundedOverride }));
      for (let i = 0; i < 4; i++) await one(specs[i % specs.length]); // pipeline compile and warm-up
      const single: number[] = [];
      const submit: number[] = [];
      for (let i = 0; i < 24; i++) {
        const r = await one(specs[i % specs.length]);
        single.push(r.roundTripMs);
        submit.push(r.submitMs);
      }
      console.log(`D2 timing GPU [${mode.name}] one block at a time (${generator.adapter}): round trip ${stats(single)}; CPU submit ${stats(submit)}`);

      // Pipelined: fill every slot, collect, repeat.
      const burst = 64;
      let sent = 0;
      let got = 0;
      const t0 = performance.now();
      while (got < burst) {
        while (sent < burst && generator.request(sent, specs[sent % specs.length], ++frame)) sent++;
        got += generator.poll(++frame).length;
        await sleep(0);
      }
      const wall = performance.now() - t0;
      console.log(`D2 timing GPU [${mode.name}] pipelined: ${burst} blocks in ${wall.toFixed(1)} ms = ${(wall / burst).toFixed(2)} ms per block, ${(burst / wall * 1000).toFixed(0)} blocks/s; ring ${JSON.stringify(generator.telemetry().latencyMs)}`);
      expect(got).toBe(burst);
      }
    } finally {
      generator.dispose();
    }
  }, 120_000);

  it('CPU workers per block, and meshing', async () => {
    const poolSize = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    const pool = new ColliderBlockWorkerPool(poolSize);
    try {
      const wild = DIRECTIONS.map((d) => surfaceBlock(d));
      await sampleDensityBlockInWorker(pool, wild[0]); // module load, field setup
      await Promise.all(Array.from({ length: poolSize }, (_, i) => sampleDensityBlockInWorker(pool, wild[i % wild.length])));
      for (const mode of MODES) {
      const specs = wild.map((spec) => ({ ...spec, biomeOverride: mode.biomeOverride, groundedOverride: mode.groundedOverride }));
      const single = await sampleDensityBlockInWorker(pool, specs[1]);
      console.log(`D2 timing CPU worker [${mode.name}], one block: in worker ${single.timing.sampleMs.toFixed(1)} ms, round trip ${single.timing.roundTripMs.toFixed(1)} ms (${BLOCK_SAMPLES} samples, ${(single.timing.sampleMs * 1000 / BLOCK_SAMPLES).toFixed(1)} us each)`);

      const burst = poolSize * 3;
      const t0 = performance.now();
      await Promise.all(Array.from({ length: burst }, (_, i) => sampleDensityBlockInWorker(pool, specs[i % specs.length])));
      const wall = performance.now() - t0;
      console.log(`D2 timing CPU workers [${mode.name}] pipelined: ${poolSize} workers, ${burst} blocks in ${wall.toFixed(0)} ms = ${(wall / burst).toFixed(1)} ms per block, ${(burst / wall * 1000).toFixed(1)} blocks/s`);

      }
      const specs = wild;
      const grid = cpuGrid(specs[1]);
      const mainMs: number[] = [];
      let triangles = 0;
      for (let i = 0; i < 20; i++) {
        const t = performance.now();
        const mesh = meshDensityBlock(grid, VOXEL_M);
        mainMs.push(performance.now() - t);
        triangles = mesh.indices.length / 3;
      }
      console.log(`D2 timing meshing on the main thread: ${stats(mainMs)}, ${triangles} triangles`);
      const workerMs: number[] = [];
      const roundTrip: number[] = [];
      for (let i = 0; i < 10; i++) {
        const r = await meshDensityBlockInWorker(pool, Float32Array.from(grid), VOXEL_M);
        workerMs.push(r.timing.meshMs);
        roundTrip.push(r.timing.roundTripMs);
      }
      console.log(`D2 timing meshing in a worker: ${stats(workerMs)}, round trip ${stats(roundTrip)}`);
      expect(triangles).toBeGreaterThan(100);
    } finally {
      pool.dispose();
    }
  }, 180_000);
});
