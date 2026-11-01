/** Side of the generated height grid for the static mesh patch case, in samples. */
export const HEIGHT_GRID_SIDE = 64;

/** A height grid as triangle-mesh data: `side * side` vertices, two triangles per cell. */
export interface HeightGrid {
  readonly side: number;
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
}

/**
 * A deterministic height grid of `side` x `side` samples spaced `cellM` apart, centred on the origin. Pure data, so the
 * same grid is built on every run and the patch case times only Jolt's collider work.
 */
export function buildHeightGrid(side: number = HEIGHT_GRID_SIDE, cellM = 1): HeightGrid {
  if (!Number.isInteger(side) || side < 2) throw new Error('A height grid needs at least 2 samples per side');
  const positions = new Float32Array(side * side * 3);
  const half = (side - 1) / 2;
  for (let z = 0; z < side; z++) {
    for (let x = 0; x < side; x++) {
      const at = (z * side + x) * 3;
      positions[at] = (x - half) * cellM;
      positions[at + 1] = 2 * Math.sin(x * 0.3) * Math.cos(z * 0.25);
      positions[at + 2] = (z - half) * cellM;
    }
  }
  const indices = new Uint32Array((side - 1) * (side - 1) * 6);
  let out = 0;
  for (let z = 0; z < side - 1; z++) {
    for (let x = 0; x < side - 1; x++) {
      const a = z * side + x;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      indices.set([a, c, b, b, c, d], out);
      out += 6;
    }
  }
  return { side, positions, indices };
}

/** Size of one float32 unit in the last place at `value` (the spacing of float32 numbers around it). */
export function float32Ulp(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude === 0) return 2 ** -149;
  return 2 ** (Math.floor(Math.log2(magnitude)) - 23);
}

/** A position the precision case places a body at. `double` is the verdict probe; the others read back the far positions. */
export interface PrecisionProbe {
  readonly label: string;
  readonly x: number;
  readonly motion: 'static' | 'dynamic';
}

/**
 * The positions the precision case reads back. 20000 and 1e7 are the far positions (both exact in float32); the `+ 0.125`
 * variants show whether the fraction survives, since float32 spacing at 1e7 is 1 m. The last probe is the verdict probe.
 */
export const PRECISION_PROBES: readonly PrecisionProbe[] = [
  { label: 'dynamic-20000', x: 20000, motion: 'dynamic' },
  { label: 'dynamic-20000.125', x: 20000.125, motion: 'dynamic' },
  { label: 'dynamic-1e7', x: 1e7, motion: 'dynamic' },
  { label: 'dynamic-1e7.125', x: 1e7 + 0.125, motion: 'dynamic' },
  { label: 'static-1e7.125', x: 1e7 + 0.125, motion: 'static' },
];

/** The label of the probe that decides the precision verdict. */
export const PRECISION_VERDICT_PROBE = 'static-1e7.125';

export type JoltPrecisionVerdict = 'double' | 'single' | 'could not determine';

/**
 * Judges the build's precision from one written and one read-back value. A value that float32 can hold exactly tells
 * nothing, so it is "could not determine". Otherwise a read-back equal to the written value means double precision, and
 * one equal to the float32 rounding of it means single precision.
 */
export function classifyPrecision(written: number, read: number): JoltPrecisionVerdict {
  if (Math.fround(written) === written) return 'could not determine';
  if (read === written) return 'double';
  if (read === Math.fround(written)) return 'single';
  return 'could not determine';
}

/** Read-back error in metres: what the body reports minus what was written. */
export function readbackErrorM(written: number, read: number): number {
  return read - written;
}
