import { getTerrainHeightScaleM } from './cell-planet-terrain-scale';

describe('planet map relief scale', () => {
  it('preserves the original relief-to-map-width ratio across planet sizes', () => {
    for (const radius of [6400, 190000, 600000, 1900000, 6371000]) {
      for (const elevation of [-0.8, 0, 1.2]) {
        const renderedHeight = elevation * getTerrainHeightScaleM(radius, 4);
        expect(renderedHeight / (2 * Math.PI * radius)).toBeCloseTo(elevation * 4 / 256, 12);
      }
    }
  });

  it('retains the old slider values at the original miniature radius', () => {
    expect(getTerrainHeightScaleM(256 / (2 * Math.PI), 4)).toBeCloseTo(4, 12);
  });

  it('allows completely flat terrain and proportional slider adjustments', () => {
    expect(getTerrainHeightScaleM(600000, 0)).toBe(0);
    expect(getTerrainHeightScaleM(600000, 8)).toBe(getTerrainHeightScaleM(600000, 4) * 2);
  });
});
