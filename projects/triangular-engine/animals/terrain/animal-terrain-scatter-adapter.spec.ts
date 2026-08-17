import { adaptTerrainScatterForAnimals, type AnimalTerrainScatterSource } from './animal-terrain-scatter-adapter';

describe('adaptTerrainScatterForAnimals', () => {
  const source = (speciesId: string, ids: string[]): AnimalTerrainScatterSource => ({
    speciesId,
    habitatKind: 'tree',
    activities: ['rest', 'feed'],
    obstacleRadiusM: 1.5,
    blocksLand: true,
    roostCapacity: 2,
    instances: ids.map((instanceId, index) => ({
      instanceId,
      worldPositionM: [index, 2, -index],
      normal: [0, 1, 0],
      surfaceUp: [0, 1, 0],
      rotationSeed01: 0,
      scaleSeed01: 0,
      embedSeed01: 0,
    })),
  });

  it('is deterministic and independent of source/instance order', () => {
    const a = adaptTerrainScatterForAnimals({ habitatVersion: 'v1', sources: [source('oak', ['b', 'a']), source('pine', ['c'])] });
    const b = adaptTerrainScatterForAnimals({ habitatVersion: 'v1', sources: [source('pine', ['c']), source('oak', ['a', 'b'])] });
    expect(a).toEqual(b);
  });

  it('emits habitats and land obstacles from the same stable instances', () => {
    const result = adaptTerrainScatterForAnimals({ habitatVersion: 'v1', sources: [source('oak', ['a'])] });
    expect(result.habitats.candidates[0].id).toBe('oak:a');
    expect(result.habitats.candidates[0].kind).toBe('tree');
    expect(result.obstacles[0].id).toBe('oak:a');
    expect(result.obstacles[0].radiusM).toBe(1.5);
    expect(result.roostSites[0]).toEqual(jasmine.objectContaining({ id: 'oak:a', capacity: 2 }));
  });

  it('applies a deterministic aggregate bound', () => {
    const result = adaptTerrainScatterForAnimals({ habitatVersion: 'v1', sources: [source('oak', ['a', 'b']), source('pine', ['c'])], maximumCandidates: 2 });
    expect(result.habitats.candidates.map((candidate) => candidate.id)).toEqual(['oak:a', 'oak:b']);
  });

  it('rejects duplicate species and invalid source values', () => {
    expect(() => adaptTerrainScatterForAnimals({ habitatVersion: 'v1', sources: [source('oak', ['a']), source('oak', ['b'])] })).toThrowError(/Duplicate/);
    expect(() => adaptTerrainScatterForAnimals({ habitatVersion: 'v1', sources: [{ ...source('oak', ['a']), suitability01: 2 }] })).toThrowError(/suitability/);
  });
});
