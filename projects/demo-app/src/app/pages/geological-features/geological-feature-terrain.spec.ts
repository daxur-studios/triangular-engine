import {
  defaultGeologicalTerrainSettings,
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

  it('is deterministic for a fixed definition', () => {
    const { volcano } = defaultGeologicalTerrainSettings();
    expect(sampleVolcano(12.5, -8.25, volcano)).toBe(
      sampleVolcano(12.5, -8.25, volcano),
    );
  });
});
