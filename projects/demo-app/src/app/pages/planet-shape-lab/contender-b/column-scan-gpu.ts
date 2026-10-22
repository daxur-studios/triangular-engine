/* eslint-disable @typescript-eslint/no-explicit-any */
import { Fn, If, Loop, ceil, float, instanceIndex, instancedArray, int, min, select, uniform } from 'three/tsl';
import type { BField } from './b-field';

/**
 * Plan 055 contender B: where the ground is along radial columns, on the GPU. Each column is a direction and an
 * altitude range; the kernel steps down from the top, and at every sign change of the field bisects the root. It keeps
 * the crossings top down: the first is the outermost surface (the height shell), more than one means an overhang.
 *
 * A column comes as its base point (the direction times R, minus the field's origin, in doubles before the float cast)
 * and its unit direction, so a sample at altitude `h` is `base + direction * h` at exactly altitude `h`.
 */

/** Crossings kept per column. */
export const CROSSING_SLOTS = 11;
/** Floats per column in the result: the crossing count, then the crossings' altitudes top down (unused slots 0). */
export const COLUMN_STRIDE = CROSSING_SLOTS + 1;
/** Columns per dispatch. */
export const COLUMN_BATCH = 65_536;
/** Most steps per column. */
const MAX_STEPS = 1024;
/** Bisection steps per crossing: the root to a 256th of a step. */
const BISECT_STEPS = 8;

export interface ColumnScanInput {
  /** Per column xyz of the base point (origin-relative, metres) and 0. */
  readonly base: Float32Array;
  /** Per column the unit direction and 0. */
  readonly direction: Float32Array;
  /** Per column: top and bottom altitude (metres), step (metres) and the footprint for the field's octaves. */
  readonly params: Float32Array;
  readonly count: number;
}

/** The renderer calls used: three's `WebGPURenderer`. */
export interface ComputeRenderer {
  computeAsync(node: unknown): Promise<void>;
  getArrayBufferAsync(attribute: unknown): Promise<ArrayBuffer>;
}

export interface ColumnScan {
  /** `COLUMN_STRIDE` floats per column; the field's origin must be set first. */
  scan(renderer: ComputeRenderer, input: ColumnScanInput): Promise<Float32Array>;
}

export function createColumnScan(b: BField): ColumnScan {
  const baseArray = instancedArray(COLUMN_BATCH, 'vec4') as any;
  const directionArray = instancedArray(COLUMN_BATCH, 'vec4') as any;
  const paramArray = instancedArray(COLUMN_BATCH, 'vec4') as any;
  const out = instancedArray(COLUMN_BATCH * COLUMN_STRIDE, 'float') as any;
  const uCount = uniform(0, 'int') as any;

  const kernel = Fn(() => {
    const c = int(instanceIndex).toVar();
    If(c.lessThan(uCount), () => {
      const base = baseArray.element(c).xyz.toVar();
      const direction = directionArray.element(c).xyz.toVar();
      const p = paramArray.element(c).toVar();
      const top = p.x.toVar();
      const bottom = p.y.toVar();
      const step = p.z.toVar();
      const footprint = p.w.toVar();
      const at = (h: any) => b.density(base.add(direction.mul(h)), h, footprint);
      const steps = (min as any)(int(ceil(top.sub(bottom).div(step))), int(MAX_STEPS)).toVar();
      const count = int(0).toVar();
      const hPrevious = top.toVar();
      const fPrevious = float(at(top)).toVar();
      const firstInRock = fPrevious.lessThan(0).toVar();
      const slot = c.mul(COLUMN_STRIDE).toVar();
      Loop(steps, ({ i }: { i: any }) => {
        const h = top.sub(float(i).add(1).mul(step)).max(bottom).toVar();
        const f = float(at(h)).toVar();
        If(f.mul(fPrevious).lessThan(0), () => {
          const lo = h.toVar();
          const hi = hPrevious.toVar();
          const fLo = f.toVar();
          Loop(BISECT_STEPS, () => {
            const mid = lo.add(hi).mul(0.5).toVar();
            const fMid = float(at(mid)).toVar();
            If(fMid.mul(fLo).greaterThan(0), () => { lo.assign(mid); fLo.assign(fMid); }).Else(() => { hi.assign(mid); });
          });
          If(count.lessThan(CROSSING_SLOTS), () => { out.element(slot.add(count).add(1)).assign(lo.add(hi).mul(0.5)); });
          count.addAssign(1);
        });
        hPrevious.assign(h);
        fPrevious.assign(f);
      });
      out.element(slot).assign(float(count));
      // No crossing: the column is all rock (ground at the top) or all air (at the bottom).
      If(count.equal(0), () => { out.element(slot.add(1)).assign(select(firstInRock, top, bottom)); });
    });
  });
  const computeNode = (kernel() as any).compute(COLUMN_BATCH, [64]);

  return {
    async scan(renderer, input) {
      const result = new Float32Array(input.count * COLUMN_STRIDE);
      for (let start = 0; start < input.count; start += COLUMN_BATCH) {
        const count = Math.min(COLUMN_BATCH, input.count - start);
        const upload = (array: any, source: Float32Array) => {
          array.value.array.set(source.subarray(start * 4, (start + count) * 4));
          array.value.needsUpdate = true;
        };
        upload(baseArray, input.base);
        upload(directionArray, input.direction);
        upload(paramArray, input.params);
        uCount.value = count;
        await renderer.computeAsync(computeNode);
        const data = new Float32Array(await renderer.getArrayBufferAsync(out.value));
        result.set(data.subarray(0, count * COLUMN_STRIDE), start * COLUMN_STRIDE);
      }
      return result;
    },
  };
}
