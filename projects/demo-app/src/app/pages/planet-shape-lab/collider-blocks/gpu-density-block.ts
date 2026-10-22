/* eslint-disable @typescript-eslint/no-explicit-any */
import { Matrix3, Vector3 } from 'three';
import { Fn, If, dot, float, floor, instanceIndex, instancedArray, uniform, vec3 } from 'three/tsl';
import { WebGPURenderer } from 'three/webgpu';
import {
  ReadbackRing, adoptGpuBuffer, createWebGpuFlowDevice, webGpuDeviceOf, type FlowDevice, type ReadbackResult, type ReadbackTelemetry,
} from 'triangular-engine/gpu-data-flow';
import { BLOCK_BYTES, BLOCK_CORNERS, BLOCK_SAMPLES, type DensityBlockSpec, type Vec3 } from './block-grid';
import {
  BIOME_OFFSET, MASK_OFFSETS, ROCK_OCTAVES, densityAt, fieldFrameMatrices, noiseOrigin, terrainEditUniforms, unitM,
  type FieldNodes, type NoiseFrameNodes,
} from '../planet-shape-field';
import { createNoiseTexture } from '../planet-shape-noise';

/**
 * Plan 055, D2 spike: a TSL compute pass that fills a corner-sampled block of the terrain v2 density on the GPU, and
 * reads it back through the data-flow core's `ReadbackRing`. The density is `densityAt`, the same graph the raymarcher
 * draws. The camera of the field is the block's origin (doubles on the CPU, then rounded to float32 in the uniform:
 * about 0.25 m on an Earth-size body, so the check bodies here are small; a production path would split origin hi/lo),
 * and every sample is the offset `(i, j, k) * voxelM` from it.
 */

export interface GpuBlockTag {
  /** Caller's label for the block. */
  readonly id: number;
  /** `performance.now()` just before the compute pass was encoded. */
  readonly startedAt: number;
  /** CPU time spent encoding and submitting the compute pass and queuing the copy. */
  readonly submitMs: number;
}

export interface GpuBlockResult {
  readonly id: number;
  readonly grid: Float32Array;
  /** Compute submit on the CPU plus copy and map until the data is usable (the readback ring's latency). */
  readonly roundTripMs: number;
  readonly submitMs: number;
}

export interface GpuDensityBlockGenerator {
  readonly radiusM: number;
  /** Adapter description, to read timings against. */
  readonly adapter: string;
  /** Dispatch the compute pass for a block and queue its readback. False when every readback slot is busy (dropped). */
  request(id: number, spec: DensityBlockSpec, frame: number): boolean;
  /** Blocks that have arrived since the last call. */
  poll(frame: number): GpuBlockResult[];
  telemetry(): ReadbackTelemetry;
  dispose(): void;
}

export interface GpuDensityBlockOptions {
  /** Blocks that may be in flight. Default 8. */
  slots?: number;
  /** An existing renderer to share; one is created (and owned) if left out. */
  renderer?: WebGPURenderer;
}

const WORKGROUP = 64;

/** True when this browser exposes WebGPU at all. */
export function webGpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as { gpu?: unknown }).gpu;
}

/**
 * Builds the generator for a body of `radiusM`, or returns null when the renderer has no WebGPU backend (a WebGL
 * fallback has no compute path that the readback ring can read).
 */
export async function createGpuDensityBlockGenerator(radiusM: number, options: GpuDensityBlockOptions = {}): Promise<GpuDensityBlockGenerator | null> {
  if (!options.renderer && !webGpuAvailable()) return null;
  if (!options.renderer && !(await (navigator as any).gpu.requestAdapter?.())) return null;
  const ownsRenderer = !options.renderer;
  const renderer = options.renderer ?? new WebGPURenderer({ antialias: false });
  await renderer.init();
  const raw = webGpuDeviceOf(renderer);
  if (!raw) {
    if (ownsRenderer) renderer.dispose();
    return null;
  }
  const info = (raw as any).adapterInfo ?? (renderer as any).backend?.adapter?.info ?? {};
  const adapter = [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(' / ') || 'unknown adapter';

  const unit = unitM(radiusM);
  const frames = fieldFrameMatrices(unit);
  const matrices = [...frames.mask, ...frames.rock, frames.biome];
  const offsets = [...MASK_OFFSETS, ...Array.from({ length: ROCK_OCTAVES }, () => [0, 0, 0] as const), BIOME_OFFSET];
  const frameNodes = matrices.map((m) => ({ uMatrix: uniform(new Matrix3().copy(m)), uOrigin: uniform(new Vector3()) }));
  const cameraU = uniform(new Vector3());
  const altitudeU = uniform(0);
  const voxelU = uniform(1);
  const groundedU = uniform(-1);
  const biomeU = uniform(-1);
  const editUniforms = terrainEditUniforms();
  const texture = createNoiseTexture();
  const out = instancedArray(BLOCK_SAMPLES, 'float');

  const field: FieldNodes = {
    noiseTexture: texture, camera: cameraU, unit: float(unit),
    maskFrames: frameNodes.slice(0, 2) as NoiseFrameNodes[], rockFrames: frameNodes.slice(2, 2 + ROCK_OCTAVES) as NoiseFrameNodes[],
    biome: { frame: frameNodes[2 + ROCK_OCTAVES] as NoiseFrameNodes, override: biomeU }, rockOverride: groundedU, edits: editUniforms,
  };

  const kernel = Fn(() => {
    const index = float(instanceIndex);
    If(index.lessThan(BLOCK_SAMPLES), () => {
      const k = floor(index.div(BLOCK_CORNERS * BLOCK_CORNERS));
      const rest = index.sub(k.mul(BLOCK_CORNERS * BLOCK_CORNERS));
      const j = floor(rest.div(BLOCK_CORNERS));
      const i = rest.sub(j.mul(BLOCK_CORNERS));
      const x = vec3(i, j, k).mul(voxelU).toVar();
      // altitude(origin + x) = altitude(origin) + (2 origin.x + |x|^2) / (|origin + x| + |origin|), no cancellation.
      const altitude = altitudeU.add(
        dot(cameraU, x).mul(2).add(dot(x, x)).div(cameraU.add(x).length().add(cameraU.length())),
      );
      out.element(instanceIndex).assign(densityAt(field, x, altitude, float(0), true));
    });
  });
  const computeNode = (kernel() as any).compute(BLOCK_SAMPLES, [WORKGROUP]);

  const flowDevice: FlowDevice = createWebGpuFlowDevice(raw);
  const ring = new ReadbackRing<GpuBlockTag>(flowDevice, { slots: options.slots ?? 8, slotBytes: BLOCK_BYTES });
  let storage: ReturnType<typeof adoptGpuBuffer> | null = null;

  const pack = (spec: DensityBlockSpec): void => {
    const [ox, oy, oz] = spec.origin;
    frameNodes.forEach((frame, n) => {
      noiseOrigin(matrices[n], new Vector3(...offsets[n]), ox, oy, oz, frame.uOrigin.value);
    });
    (cameraU.value as Vector3).set(ox, oy, oz);
    altitudeU.value = Math.hypot(ox, oy, oz) - radiusM;
    voxelU.value = spec.voxelM;
    groundedU.value = spec.groundedOverride ?? -1;
    biomeU.value = spec.biomeOverride ?? -1;
    editUniforms.set(spec.edits ?? [], spec.origin as Vec3, radiusM);
  };

  return {
    radiusM,
    adapter,
    request(id, spec, frame) {
      if (ring.freeSlots === 0) return ring.request(storage as never, 0, frame, undefined as never);
      const startedAt = performance.now();
      pack(spec);
      renderer.compute(computeNode);
      if (!storage) {
        const gpu = (renderer as any).backend.get(out.value).buffer;
        storage = adoptGpuBuffer(gpu, 'storage', 'collider-density-block');
      }
      const submitMs = performance.now() - startedAt;
      return ring.request(storage, 0, frame, { id, startedAt, submitMs });
    },
    poll(frame) {
      return ring.poll(frame).map((r: ReadbackResult<GpuBlockTag>) => ({
        id: r.tag.id, grid: new Float32Array(r.data), roundTripMs: r.tag.submitMs + r.latencyMs, submitMs: r.tag.submitMs,
      }));
    },
    telemetry: () => ring.telemetry(),
    dispose() {
      ring.destroy();
      if (ownsRenderer) renderer.dispose();
    },
  };
}
