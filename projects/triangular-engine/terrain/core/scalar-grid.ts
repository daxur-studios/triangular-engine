/**
 * Small deterministic scalar cache for worker-side material masks.
 *
 * Coordinates are in the caller's shared sample space. Keeping the cache
 * keyed by integer grid coordinates makes results independent of traversal
 * order and lets adjacent tiles use the same interpolation lattice.
 */
export interface IInterpolatedScalarCache {
  readonly sampleCount: number;
  sample(x: number, y: number, evaluate: (gridX: number, gridY: number) => number): number;
}

export function bilinearInterpolateScalar(
  topLeft: number,
  topRight: number,
  bottomLeft: number,
  bottomRight: number,
  x01: number,
  y01: number,
): number {
  const top = topLeft + (topRight - topLeft) * x01;
  const bottom = bottomLeft + (bottomRight - bottomLeft) * x01;
  return top + (bottom - top) * y01;
}

export function createInterpolatedScalarCache(step: number): IInterpolatedScalarCache {
  if (!Number.isFinite(step) || step <= 0) {
    throw new RangeError('Scalar cache step must be greater than zero.');
  }

  const values = new Map<string, number>();
  const read = (
    gridX: number,
    gridY: number,
    evaluate: (x: number, y: number) => number,
  ): number => {
    const key = `${gridX},${gridY}`;
    const existing = values.get(key);
    if (existing !== undefined) return existing;
    const value = evaluate(gridX * step, gridY * step);
    values.set(key, value);
    return value;
  };

  return {
    get sampleCount() {
      return values.size;
    },
    sample(x, y, evaluate) {
      const gridX = Math.floor(x / step);
      const gridY = Math.floor(y / step);
      const x01 = x / step - gridX;
      const y01 = y / step - gridY;
      return bilinearInterpolateScalar(
        read(gridX, gridY, evaluate),
        read(gridX + 1, gridY, evaluate),
        read(gridX, gridY + 1, evaluate),
        read(gridX + 1, gridY + 1, evaluate),
        x01,
        y01,
      );
    },
  };
}
