import { computeScatterPixelFadeBand, computeScatterWindowRadiusM } from './scatter-fade-band';

describe('scatter fade band', () => {
  it('derives the band from the object size with the pixel rule', () => {
    const small = computeScatterPixelFadeBand(4);
    const large = computeScatterPixelFadeBand(8);
    expect(large.startM).toBeCloseTo(small.startM * 2, 6);
    expect(large.endM).toBeGreaterThan(large.startM);
    // 8 m at 12 px with 1 px = 0.001 x distance.
    expect(large.startM).toBeCloseTo(666.7, 0);
    expect(computeScatterPixelFadeBand(2).endM).toBeCloseTo(500, 6);
  });

  it('rejects a band with no width', () => {
    expect(() => computeScatterPixelFadeBand(0)).toThrowError(RangeError);
    expect(() => computeScatterPixelFadeBand(2, { pixelPerDistance: 0.001, startPixels: 4, endPixels: 4 })).toThrowError(RangeError);
  });

  it('sizes the window from the band end and twice the recentre drift', () => {
    expect(computeScatterWindowRadiusM(3000, 400)).toBe(3800);
    expect(computeScatterWindowRadiusM(3001, 400)).toBe(3900);
  });
});
