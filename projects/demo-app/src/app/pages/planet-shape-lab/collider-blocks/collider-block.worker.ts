/// <reference lib="webworker" />

import { BLOCK_SAMPLES } from './block-grid';
import type { ColliderBlockReply, ColliderBlockRequest } from './collider-block-messages';
import { fillDensityBlockCpu } from './cpu-density-block';
import { meshDensityBlock } from './surface-nets';
import { createTerrainFieldCpu, type TerrainFieldCpu } from '../planet-shape-field-cpu';
import { generateNoiseBytes } from '../planet-shape-noise';

const noise = generateNoiseBytes();
const fields = new Map<number, TerrainFieldCpu>();

function fieldFor(radiusM: number): TerrainFieldCpu {
  let field = fields.get(radiusM);
  if (!field) {
    field = createTerrainFieldCpu(radiusM, noise, []);
    fields.set(radiusM, field);
  }
  return field;
}

addEventListener('message', (event: MessageEvent<ColliderBlockRequest>) => {
  const request = event.data;
  try {
    if (request.kind === 'mesh') {
      const t0 = performance.now();
      const mesh = meshDensityBlock(request.grid, request.voxelM);
      const reply: ColliderBlockReply = { id: request.id, kind: 'mesh', mesh, meshMs: performance.now() - t0 };
      postMessage(reply, [mesh.positions.buffer, mesh.indices.buffer]);
      return;
    }
    const t0 = performance.now();
    const grid = new Float32Array(BLOCK_SAMPLES);
    fillDensityBlockCpu(fieldFor(request.spec.radiusM), request.spec, grid);
    const sampleMs = performance.now() - t0;
    if (request.kind === 'sample') {
      const reply: ColliderBlockReply = { id: request.id, kind: 'sample', grid, sampleMs };
      postMessage(reply, [grid.buffer]);
      return;
    }
    const t1 = performance.now();
    const mesh = meshDensityBlock(grid, request.spec.voxelM);
    const reply: ColliderBlockReply = { id: request.id, kind: 'sample-mesh', mesh, sampleMs, meshMs: performance.now() - t1 };
    postMessage(reply, [mesh.positions.buffer, mesh.indices.buffer]);
  } catch (error) {
    const reply: ColliderBlockReply = { id: request.id, kind: 'error', message: error instanceof Error ? error.message : String(error) };
    postMessage(reply);
  }
});
