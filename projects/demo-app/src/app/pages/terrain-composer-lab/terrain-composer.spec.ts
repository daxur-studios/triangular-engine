import { defaultComposerSettings, sampleHeightmap, TerrainComposerField, type ComposerFeature } from './terrain-composer';

describe('TerrainComposerField', () => {
  const features: ComposerFeature[] = [
    { id: 'island', layer: 'island', closed: true, points: [[-10, 0, -10], [10, 0, -10], [10, 0, 10], [-10, 0, 10]] },
    { id: 'mountain', layer: 'mountain', closed: false, points: [[-8, 0, 0], [8, 0, 0]] },
    { id: 'river', layer: 'river', closed: false, points: [[0, 0, -8], [0, 0, 8]] },
  ];

  it('combines island, ridge, and river contributions', () => {
    const settings = { ...defaultComposerSettings(), noiseAmplitude: 0 };
    const field = new TerrainComposerField(features, settings);
    expect(field.sample([0, 0, 0]).elevationM).toBeGreaterThan(field.sample([0, 0, 30]).elevationM);
    const riverOnly = new TerrainComposerField(
      features.filter((feature) => feature.layer !== 'mountain'),
      settings,
    );
    expect(riverOnly.sample([0, 0, 0]).elevationM).toBeLessThan(riverOnly.sample([8, 0, 0]).elevationM);
  });

  it('produces a normalized heightmap buffer', () => {
    const field = new TerrainComposerField(features, { ...defaultComposerSettings(), noiseAmplitude: 0 });
    const heightmap = sampleHeightmap(field, 16, 40);
    expect(heightmap.length).toBe(256);
    expect(Math.min(...heightmap)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...heightmap)).toBeLessThanOrEqual(255);
  });
});
