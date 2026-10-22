import type { DensityBlockSpec } from './block-grid';
import type { SurfaceNetsMesh } from './surface-nets';

/** Messages of `collider-block.worker.ts`. `id` pairs a reply with its request. */
export type ColliderBlockRequest =
  | { id: number; kind: 'sample'; spec: DensityBlockSpec }
  | { id: number; kind: 'mesh'; grid: Float32Array; voxelM: number }
  | { id: number; kind: 'sample-mesh'; spec: DensityBlockSpec };

export type ColliderBlockReply =
  | { id: number; kind: 'sample'; grid: Float32Array; sampleMs: number }
  | { id: number; kind: 'mesh'; mesh: SurfaceNetsMesh; meshMs: number }
  | { id: number; kind: 'sample-mesh'; mesh: SurfaceNetsMesh; sampleMs: number; meshMs: number }
  | { id: number; kind: 'error'; message: string };
