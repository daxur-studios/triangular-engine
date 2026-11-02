import { WATER_LOD_SPIKE_QUALITIES, waterLodSpikeQuality } from './water-lod-spike-quality';

describe('water LOD spike quality tiers', () => {
  it('makes the best tier the tuned filter at the default mesh', () => {
    const best = WATER_LOD_SPIKE_QUALITIES[0];
    expect(best.lodBias).toBe(1);
    expect(best.cellPixels).toBe(4);
    expect(best.leafCap).toBe(4096);
  });

  it('gets cheaper at every step: a wider footprint, a coarser mesh, fewer leaves', () => {
    for (let i = 1; i < WATER_LOD_SPIKE_QUALITIES.length; i++) {
      const better = WATER_LOD_SPIKE_QUALITIES[i - 1];
      const worse = WATER_LOD_SPIKE_QUALITIES[i];
      expect(worse.lodBias).toBeGreaterThan(better.lodBias);
      expect(worse.cellPixels).toBeGreaterThanOrEqual(better.cellPixels);
      expect(worse.leafCap).toBeLessThan(better.leafCap);
    }
  });

  it('has unique ids and finds each by id', () => {
    expect(new Set(WATER_LOD_SPIKE_QUALITIES.map((tier) => tier.id)).size).toBe(WATER_LOD_SPIKE_QUALITIES.length);
    for (const tier of WATER_LOD_SPIKE_QUALITIES) expect(waterLodSpikeQuality(tier.id)).toBe(tier);
  });
});
