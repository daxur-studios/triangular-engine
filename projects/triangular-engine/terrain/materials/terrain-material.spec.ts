import {
  applyTerrainMacroVariation,
  evaluateTerrainMaterial,
  packTerrainMaterialWeights,
  sampleTerrainMacroVariation,
  terrainMaterialColorRgb,
} from './terrain-material';

function query(overrides: Partial<Parameters<typeof evaluateTerrainMaterial>[0]> = {}) {
  return {
    elevationM: 800,
    seaLevelM: 0,
    minElevationM: -1000,
    maxElevationM: 6000,
    slope01: 0.1,
    moisture01: 0.7,
    temperature01: 0.5,
    ...overrides,
  };
}

describe('terrain material evaluation', () => {
  it('returns normalized weights in a stable layer order', () => {
    const sample = evaluateTerrainMaterial(query());
    const packed = packTerrainMaterialWeights(sample);

    expect(packed.length).toBe(5);
    expect(Array.from(packed).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1);
    expect(Array.from(packed).every((weight) => weight >= 0 && weight <= 1)).toBe(true);
  });

  it('keeps deep ocean material separate from shallow shore material', () => {
    const shallow = evaluateTerrainMaterial(query({ elevationM: -10 }));
    const deep = evaluateTerrainMaterial(query({ elevationM: -900 }));

    expect(shallow.weights.sand).toBeGreaterThan(deep.weights.sand);
    expect(deep.weights.water).toBeGreaterThan(shallow.weights.water);
    expect(shallow.shore01).toBeGreaterThan(deep.shore01);
  });

  it('raises rock and wetness around steep ridges and rivers', () => {
    const plain = evaluateTerrainMaterial(query({ slope01: 0.05 }));
    const feature = evaluateTerrainMaterial(
      query({ slope01: 0.9, ridge01: 1, river01: 1 }),
    );

    expect(feature.weights.rock).toBeGreaterThan(plain.weights.rock);
    expect(feature.wetness01).toBeGreaterThan(plain.wetness01);
    expect(feature.ridge01).toBe(1);
    expect(feature.river01).toBe(1);
  });

  it('allows explicit ice and arid biome signals to override generic climate', () => {
    const regular = evaluateTerrainMaterial(query({ elevationM: 100 }));
    const partialIce = evaluateTerrainMaterial(
      query({ elevationM: 100, temperature01: 0.5, snowIce01: 0.5 }),
    );
    const ice = evaluateTerrainMaterial(
      query({ elevationM: 100, temperature01: 0.5, snowIce01: 1 }),
    );
    const desert = evaluateTerrainMaterial(
      query({ elevationM: 800, moisture01: 0.1, arid01: 1 }),
    );

    expect(regular.weights.sand).toBeGreaterThan(0);
    expect(partialIce.weights.sand).toBeGreaterThan(0);
    expect(partialIce.weights.sand).toBeLessThan(regular.weights.sand);
    expect(ice.weights.snow).toBeGreaterThan(0.9);
    expect(ice.weights.sand).toBe(0);
    expect(ice.snow01).toBe(1);
    expect(desert.weights.sand).toBeGreaterThan(0.6);
    expect(desert.weights.grass).toBeLessThan(0.2);
    expect(desert.arid01).toBe(1);
  });

  it('produces snow from a cold climate even below the elevation snowline', () => {
    const cold = evaluateTerrainMaterial(query({ elevationM: 100, temperature01: 0.05 }));
    const temperate = evaluateTerrainMaterial(query({ elevationM: 100, temperature01: 0.5 }));

    expect(cold.snow01).toBeGreaterThan(temperate.snow01);
    expect(cold.weights.snow).toBeGreaterThan(temperate.weights.snow);
  });

  it('supports reusable output buffers without changing the result', () => {
    const sample = evaluateTerrainMaterial(query());
    const target = new Float32Array(5);
    expect(packTerrainMaterialWeights(sample, target)).toBe(target);
    expect(Array.from(target)).toEqual(Array.from(packTerrainMaterialWeights(sample)));
  });

  it('converts the same semantic sample into a bounded shared stylized colour', () => {
    const sample = evaluateTerrainMaterial(query({ elevationM: 1000, slope01: 0.8 }));
    const color = terrainMaterialColorRgb(sample);
    const lavaLandColor = terrainMaterialColorRgb(sample, {
      oceanSubstance: 'lava',
    });
    const waterSample = evaluateTerrainMaterial(query({ elevationM: -900 }));
    const waterColor = terrainMaterialColorRgb(waterSample);
    const lavaWaterColor = terrainMaterialColorRgb(waterSample, {
      oceanSubstance: 'lava',
    });

    expect(color.every((channel) => channel >= 0 && channel <= 1)).toBe(true);
    expect(lavaLandColor).toEqual(color);
    expect(lavaWaterColor).not.toEqual(waterColor);
  });

  it('provides deterministic world-space macro variation and keeps water unchanged', () => {
    const sample = evaluateTerrainMaterial(query({ elevationM: 800 }));
    const variationA = sampleTerrainMacroVariation([100, 20, -40], 48);
    const variationB = sampleTerrainMacroVariation([100, 20, -40], 48);
    const base = terrainMaterialColorRgb(sample);
    const varied = applyTerrainMacroVariation(base, sample, variationA, 0.35);
    const partialWaterSample = {
      ...sample,
      weights: { ...sample.weights, water: 0.4 },
    };
    const partialWaterVaried = applyTerrainMacroVariation(
      base,
      partialWaterSample,
      variationA,
      1,
    );
    const waterSample = {
      ...evaluateTerrainMaterial(query({ elevationM: -900 })),
      weights: { water: 1, sand: 0, grass: 0, rock: 0, snow: 0 },
    };
    const waterBase = terrainMaterialColorRgb(waterSample);
    const waterVaried = applyTerrainMacroVariation(waterBase, waterSample, variationA, 1);
    const fullLandVaried = applyTerrainMacroVariation(base, sample, variationA, 1);
    const partialChange = partialWaterVaried.reduce(
      (sum, channel, index) => sum + Math.abs(channel - base[index]),
      0,
    );
    const fullLandChange = fullLandVaried.reduce(
      (sum, channel, index) => sum + Math.abs(channel - base[index]),
      0,
    );

    expect(variationA).toBe(variationB);
    expect(varied).not.toEqual(base);
    expect(partialChange).toBeGreaterThan(0);
    expect(partialChange).toBeLessThan(fullLandChange);
    expect(waterVaried).toEqual(waterBase);
  });
});
