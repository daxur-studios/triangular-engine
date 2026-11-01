import {
  buildHeightGrid, classifyPrecision, float32Ulp, HEIGHT_GRID_SIDE, PRECISION_PROBES, PRECISION_VERDICT_PROBE, readbackErrorM,
} from './jolt-perf-math';

describe('jolt-perf math', () => {
  describe('buildHeightGrid', () => {
    it('builds a 64 by 64 grid with two triangles per cell', () => {
      const grid = buildHeightGrid();
      expect(grid.side).toBe(HEIGHT_GRID_SIDE);
      expect(grid.side).toBe(64);
      expect(grid.positions.length).toBe(64 * 64 * 3);
      expect(grid.indices.length / 3).toBe(2 * 63 * 63);
    });

    it('keeps every index inside the vertex range', () => {
      const grid = buildHeightGrid(8);
      const vertices = 8 * 8;
      expect(Array.from(grid.indices).every((index) => index >= 0 && index < vertices)).toBeTrue();
    });

    it('is deterministic and centred on the origin in x and z', () => {
      const first = buildHeightGrid(16);
      const second = buildHeightGrid(16);
      expect(Array.from(first.positions)).toEqual(Array.from(second.positions));
      const xs = Array.from({ length: 16 }, (_, i) => first.positions[i * 3]);
      expect(xs[0]).toBeCloseTo(-7.5, 5);
      expect(xs[15]).toBeCloseTo(7.5, 5);
    });

    it('rejects a grid smaller than two samples per side', () => {
      expect(() => buildHeightGrid(1)).toThrowError(/at least 2/);
      expect(() => buildHeightGrid(2.5)).toThrowError(/at least 2/);
    });
  });

  describe('float32Ulp', () => {
    it('is 1 m at 1e7, where float32 spacing is one unit', () => {
      expect(float32Ulp(1e7)).toBe(1);
    });

    it('is 2^-9 at 20000', () => {
      expect(float32Ulp(20000)).toBe(2 ** -9);
    });

    it('is the smallest subnormal step at zero', () => {
      expect(float32Ulp(0)).toBe(2 ** -149);
    });
  });

  describe('classifyPrecision', () => {
    it('reads a double build when the fraction survives', () => {
      expect(classifyPrecision(1e7 + 0.125, 1e7 + 0.125)).toBe('double');
    });

    it('reads a single build when the value rounds to float32', () => {
      expect(classifyPrecision(1e7 + 0.125, Math.fround(1e7 + 0.125))).toBe('single');
    });

    it('gives no verdict when the read value matches neither', () => {
      expect(classifyPrecision(1e7 + 0.125, 1e7 + 3)).toBe('could not determine');
    });

    it('gives no verdict for a value float32 holds exactly', () => {
      expect(classifyPrecision(1e7, 1e7)).toBe('could not determine');
      expect(classifyPrecision(20000, 20000)).toBe('could not determine');
    });
  });

  describe('readbackErrorM', () => {
    it('is the read value minus the written value', () => {
      expect(readbackErrorM(1e7 + 0.125, 1e7)).toBe(-0.125);
      expect(readbackErrorM(20000, 20000)).toBe(0);
    });
  });

  describe('PRECISION_PROBES', () => {
    it('includes the far positions and a static verdict probe at 1e7 + 0.125', () => {
      const labels = PRECISION_PROBES.map((probe) => probe.label);
      expect(labels).toContain('dynamic-20000');
      expect(labels).toContain('dynamic-1e7');
      const verdict = PRECISION_PROBES.find((probe) => probe.label === PRECISION_VERDICT_PROBE);
      expect(verdict).toBeDefined();
      expect(verdict?.motion).toBe('static');
      expect(verdict?.x).toBe(1e7 + 0.125);
    });
  });
});
