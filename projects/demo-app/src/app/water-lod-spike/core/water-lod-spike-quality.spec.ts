import { WATER_LOD_SPIKE_QUALITIES, WATER_LOD_SPIKE_SPHERE_QUALITIES, waterLodSpikeQuality, waterLodSpikeSphereQuality } from './water-lod-spike-quality';

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

  it('gives the sphere page ultra at 2048 leaves and leaves the other tiers as they are', () => {
    expect(waterLodSpikeSphereQuality('ultra').leafCap).toBe(2048);
    expect(waterLodSpikeSphereQuality('ultra').cellPixels).toBe(4);
    for (const tier of WATER_LOD_SPIKE_QUALITIES.slice(1)) expect(waterLodSpikeSphereQuality(tier.id)).toEqual(tier);
    for (let i = 1; i < WATER_LOD_SPIKE_SPHERE_QUALITIES.length; i++) {
      expect(WATER_LOD_SPIKE_SPHERE_QUALITIES[i].leafCap).toBeLessThan(WATER_LOD_SPIKE_SPHERE_QUALITIES[i - 1].leafCap);
    }
  });

  it('has unique ids and finds each by id', () => {
    expect(new Set(WATER_LOD_SPIKE_QUALITIES.map((tier) => tier.id)).size).toBe(WATER_LOD_SPIKE_QUALITIES.length);
    for (const tier of WATER_LOD_SPIKE_QUALITIES) expect(waterLodSpikeQuality(tier.id)).toBe(tier);
  });
});
