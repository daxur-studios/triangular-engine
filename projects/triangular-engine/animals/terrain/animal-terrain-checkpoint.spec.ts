import { adaptTerrainScatterForAnimals } from './animal-terrain-scatter-adapter';
import { TerrainAnimalWorldSurface } from './terrain-animal-world-surface';
import { ConstantTerrainField, CylinderTerrainDomain, PlaneTerrainDomain, SphereTerrainDomain } from 'triangular-engine/terrain';

describe('terrain-integrated animal checkpoint contract', () => {
  it('keeps adapter output deterministic across all supported terrain topologies', () => {
    const cases = [
      { id: 'plane', surface: new TerrainAnimalWorldSurface(new ConstantTerrainField(0), new PlaneTerrainDomain(20)), position: { x: 0, y: 0, z: 0 } },
      { id: 'sphere', surface: new TerrainAnimalWorldSurface(new ConstantTerrainField(0), new SphereTerrainDomain(8)), position: { x: 8, y: 0, z: 0 } },
      { id: 'cylinder', surface: new TerrainAnimalWorldSurface(new ConstantTerrainField(0), new CylinderTerrainDomain({ radiusM: 8, lengthM: 20 })), position: { x: 0, y: 8, z: 0 } },
    ] as const;
    for (const value of cases) {
      const sample = value.surface.sample(value.position);
      const input = {
        habitatVersion: `${value.id}-v1`,
        sources: [{ speciesId: 'tree', roostCapacity: 3, blocksLand: true, obstacleRadiusM: 1,
          instances: [{ instanceId: 'tree-0', worldPositionM: [sample.position.x, sample.position.y, sample.position.z] as [number, number, number], normal: [sample.normal.x, sample.normal.y, sample.normal.z] as [number, number, number], surfaceUp: [sample.surfaceUp.x, sample.surfaceUp.y, sample.surfaceUp.z] as [number, number, number], rotationSeed01: 0, scaleSeed01: 0, embedSeed01: 0 }] }],
      };
      const first = adaptTerrainScatterForAnimals(input);
      const second = adaptTerrainScatterForAnimals(input);
      expect(first).toEqual(second);
      expect(first.habitats.candidates[0].position).toEqual(sample.position);
      expect(first.obstacles[0].surfaceUp).toEqual(sample.surfaceUp);
      expect(first.roostSites[0].capacity).toBe(3);
      expect(sample.walkable).toBeTrue();
    }
  });
});
