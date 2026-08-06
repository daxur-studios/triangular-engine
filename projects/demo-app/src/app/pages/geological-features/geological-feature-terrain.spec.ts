import {
  defaultGeologicalTerrainSettings,
  sampleGeologicalComposition,
  sampleGeologicalTerrain,
  sampleCanyon,
  sampleVolcano,
} from './geological-feature-terrain';

describe('geological feature terrain', () => {
  it('creates a raised volcano with a depressed crater', () => {
    const { volcano } = defaultGeologicalTerrainSettings();
    const centre = sampleVolcano(0, 0, volcano);
    const craterRim = sampleVolcano(volcano.craterRadius, 0, volcano);
    const outside = sampleVolcano(volcano.radius * 1.2, 0, volcano);

    expect(craterRim).toBeGreaterThan(centre);
    expect(craterRim).toBeGreaterThan(outside);
    expect(outside).toBeCloseTo(0, 5);
  });

  it('creates a canyon channel below the surrounding terrain', () => {
    const { canyon } = defaultGeologicalTerrainSettings();
    const centreX = Math.sin(canyon.seed) * canyon.meander;
    const floor = sampleCanyon(centreX, 0, canyon);
    const outside = sampleCanyon(centreX + canyon.width * 4, 0, canyon);

    expect(floor).toBeLessThan(-canyon.depth * 0.9);
    expect(Math.abs(outside)).toBeLessThan(1);
  });

  it('keeps the canyon profile coherent at different positions along its path', () => {
    const { canyon } = defaultGeologicalTerrainSettings();
    const start = Math.sin(-canyon.pathLength / 2 / canyon.bendWavelength + canyon.seed) * canyon.meander;
    const end = Math.sin(canyon.pathLength / 2 / canyon.bendWavelength + canyon.seed) * canyon.meander;

    expect(sampleCanyon(start, -canyon.pathLength / 2, canyon)).toBeLessThan(-canyon.depth * 0.8);
    expect(sampleCanyon(end, canyon.pathLength / 2, canyon)).toBeLessThan(-canyon.depth * 0.8);
  });

  it('is deterministic for a fixed definition', () => {
    const { volcano } = defaultGeologicalTerrainSettings();
    expect(sampleVolcano(12.5, -8.25, volcano)).toBe(
      sampleVolcano(12.5, -8.25, volcano),
    );
  });

  it('does not jump across the polar coordinate seam', () => {
    const { volcano } = defaultGeologicalTerrainSettings();
    const epsilon = 0.0001;
    const radius = volcano.radius * 0.7;
    const left = sampleVolcano(-radius, epsilon, volcano);
    const right = sampleVolcano(-radius, -epsilon, volcano);

    expect(Math.abs(left - right)).toBeLessThan(0.01);
  });

  it('changes the large-scale ridge identity with the seed', () => {
    const { volcano } = defaultGeologicalTerrainSettings();
    const first = sampleVolcano(31, 12, { ...volcano, ridgeCount: 5 });
    const second = sampleVolcano(31, 12, { ...volcano, ridgeCount: 12 });

    expect(first).not.toBe(second);
  });

  it('allows the seeded ridge flow to change handedness', () => {
    const { volcano } = defaultGeologicalTerrainSettings();
    const samples = [3, 7, 19, 41, 107].map((seed) =>
      sampleVolcano(31, 12, { ...volcano, seed }),
    );

    expect(new Set(samples).size).toBeGreaterThan(1);
  });

  it('composes deterministic volcanic fields with multiple instances', () => {
    const settings = defaultGeologicalTerrainSettings();
    const first = sampleGeologicalComposition('volcanic-field', 24, -18, settings);
    const second = sampleGeologicalComposition('volcanic-field', 24, -18, settings);

    expect(first).toBe(second);
    expect(first).not.toBe(sampleGeologicalComposition('volcanic-field', -180, -180, settings));
    expect(first).not.toBe(
      sampleGeologicalComposition('volcanic-field', 24, -18, {
        ...settings,
        volcano: { ...settings.volcano, seed: settings.volcano.seed + 1 },
      }),
    );
  });

  it('keeps a canyon network as a negative regional composition', () => {
    const settings = defaultGeologicalTerrainSettings();
    const centre = sampleGeologicalComposition('canyon-network', -42, 0, settings);
    const distant = sampleGeologicalComposition('canyon-network', 180, 180, settings);

    expect(centre).toBeLessThan(distant);
  });

  it('uses feature order as terrain history', () => {
    const settings = defaultGeologicalTerrainSettings();
    const canyonAfterVolcano = sampleGeologicalTerrain(
      'volcanic-field', ['volcano', 'canyon'], 0, 0, settings,
    );
    const volcanoAfterCanyon = sampleGeologicalTerrain(
      'volcanic-field', ['canyon', 'volcano'], 0, 0, settings,
    );

    expect(canyonAfterVolcano).toBeLessThan(volcanoAfterCanyon);
  });
});
