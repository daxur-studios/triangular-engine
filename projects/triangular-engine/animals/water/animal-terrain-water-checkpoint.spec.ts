import { Vector3 } from 'three';
import { TerrainAnimalWorldSurface } from '../terrain/terrain-animal-world-surface';
import { TerrainWaterAnimalVolume } from './terrain-water-animal-volume';
import { ConstantTerrainField, CylinderTerrainDomain, PlaneTerrainDomain, SphereTerrainDomain } from 'triangular-engine/terrain';
import { CylinderWaterDomain, PlaneWaterDomain, SphereWaterDomain, type WaterSurface } from 'triangular-engine/water';

describe('terrain-backed water checkpoint contract', () => {
  const surface: WaterSurface = {
    getHeight: () => 0,
    getNormal: (_x, _z, _time, out = new Vector3()) => out.set(0, 1, 0),
    getFlow: (_x, _z, _time, out = new Vector3()) => out.set(.1, 0, .05),
  };

  it('keeps fish sample points inside water on plane, sphere, and cylinder domains', () => {
    const cases = [
      { id: 'plane', terrain: new TerrainAnimalWorldSurface(new ConstantTerrainField(-3), new PlaneTerrainDomain(20)), domain: new PlaneWaterDomain(), position: { x: 0, y: -1.5, z: 0 } },
      { id: 'sphere', terrain: new TerrainAnimalWorldSurface(new ConstantTerrainField(-3), new SphereTerrainDomain(8)), domain: new SphereWaterDomain(8), position: { x: 6.5, y: 0, z: 0 } },
      { id: 'cylinder', terrain: new TerrainAnimalWorldSurface(new ConstantTerrainField(-3), new CylinderTerrainDomain({ radiusM: 8, lengthM: 20 })), domain: new CylinderWaterDomain(8, { axis: new Vector3(1, 0, 0), lengthM: 20 }), position: { x: 0, y: 6.5, z: 0 } },
    ] as const;
    for (const value of cases) {
      const water = new TerrainWaterAnimalVolume({ terrain: value.terrain, bodies: [{ body: { id: `${value.id}-water`, domain: value.domain, surface } }] });
      const sample = water.sample(value.position, 0);
      expect(sample.containsWater).toBeTrue();
      expect(sample.surfaceClearanceM).toBeGreaterThanOrEqual(0.5);
      expect(sample.bottomClearanceM).toBeGreaterThanOrEqual(0.5);
      const moved = water.moveAlongSurface(value.position, { x: 0, y: 0, z: 0 }, 0, 0);
      expect(moved).toBeDefined();
      expect(water.sample(moved!.position, 0).containsWater).toBeTrue();
    }
  });
});
