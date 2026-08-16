import { Vector3 } from 'three';
import {
  ConstantTerrainField,
  CylinderTerrainDomain,
  PlaneTerrainDomain,
  SphereTerrainDomain,
} from 'triangular-engine/terrain';
import {
  CylinderWaterDomain,
  PlaneWaterDomain,
  SphereWaterDomain,
  type WaterBody,
  type WaterSurface,
} from 'triangular-engine/water';
import { TerrainAnimalWorldSurface } from '../terrain/terrain-animal-world-surface';
import { TerrainWaterAnimalVolume, type AnimalWaterBody } from './terrain-water-animal-volume';

const flatWater: WaterSurface = {
  getHeight: () => 0,
  getNormal: (_x, _z, _time, out = new Vector3()) => out.set(0, 1, 0),
  getFlow: (_x, _z, _time, out = new Vector3()) => out.set(0, 0, 0),
};

type Fixture = {
  readonly name: string;
  readonly volume: TerrainWaterAnimalVolume;
  readonly terrain: TerrainAnimalWorldSurface;
  readonly waterDomain: WaterBody['domain'];
  readonly water: { x: number; y: number; z: number };
  readonly above: { x: number; y: number; z: number };
  readonly below: { x: number; y: number; z: number };
  readonly tangentFrom: { x: number; y: number; z: number };
  readonly tangentTo: { x: number; y: number; z: number };
};

function body(
  domain: WaterBody['domain'],
  contains?: WaterBody['contains'],
  id = 'test-sea',
  priority?: number,
): AnimalWaterBody {
  return {
    body: { id, domain, surface: flatWater, contains, priority },
    containsSurface: contains
      ? (position) => contains(new Vector3(position.x, position.y, position.z))
      : undefined,
  };
}

function makeFixtures(): Fixture[] {
  const planeDomain = new PlaneTerrainDomain(100);
  const planeWater = new PlaneWaterDomain();
  const planeSurface = new TerrainAnimalWorldSurface(
    new ConstantTerrainField(-10),
    planeDomain,
  );
  const planeVolume = new TerrainWaterAnimalVolume({
    terrain: planeSurface,
    bodies: [body(planeWater)],
  });

  const sphereDomain = new SphereTerrainDomain(100);
  const sphereWater = new SphereWaterDomain(100);
  const sphereSurface = new TerrainAnimalWorldSurface(
    new ConstantTerrainField(-10),
    sphereDomain,
  );
  const sphereVolume = new TerrainWaterAnimalVolume({
    terrain: sphereSurface,
    bodies: [body(sphereWater)],
  });

  const cylinderDomain = new CylinderTerrainDomain({
    radiusM: 50,
    lengthM: 100,
    levelZeroAngularPatchCount: 8,
    levelZeroAxialPatchCount: 2,
  });
  const cylinderWater = new CylinderWaterDomain(50, {
    axis: new Vector3(1, 0, 0),
    lengthM: 100,
  });
  const cylinderSurface = new TerrainAnimalWorldSurface(
    new ConstantTerrainField(-10),
    cylinderDomain,
  );
  const cylinderVolume = new TerrainWaterAnimalVolume({
    terrain: cylinderSurface,
    bodies: [body(cylinderWater)],
  });

  return [
    {
      name: 'plane',
      volume: planeVolume,
      terrain: planeSurface,
      waterDomain: planeWater,
      water: { x: 0, y: -5, z: 0 },
      above: { x: 0, y: 2, z: 0 },
      below: { x: 0, y: -11, z: 0 },
      tangentFrom: { x: -4, y: -5, z: 0 },
      tangentTo: { x: 4, y: -5, z: 0 },
    },
    {
      name: 'sphere',
      volume: sphereVolume,
      terrain: sphereSurface,
      waterDomain: sphereWater,
      water: { x: 95, y: 0, z: 0 },
      above: { x: 102, y: 0, z: 0 },
      below: { x: 89, y: 0, z: 0 },
      tangentFrom: { x: 99.5, y: -4, z: 0 },
      tangentTo: { x: 99.5, y: 4, z: 0 },
    },
    {
      name: 'cylinder',
      volume: cylinderVolume,
      terrain: cylinderSurface,
      waterDomain: cylinderWater,
      water: { x: 0, y: 55, z: 0 },
      above: { x: 0, y: 48, z: 0 },
      below: { x: 0, y: 61, z: 0 },
      tangentFrom: { x: -4, y: 55, z: 0 },
      tangentTo: { x: 4, y: 55, z: 0 },
    },
  ];
}

describe('TerrainWaterAnimalVolume', () => {
  it('classifies water, air, and terrain for plane, sphere, and cylinder worlds', () => {
    for (const fixture of makeFixtures()) {
      expect(fixture.volume.sample(fixture.water, 0).location)
        .withContext(`${fixture.name} water`).toBe('water');
      expect(fixture.volume.sample(fixture.water, 0).containsWater)
        .withContext(`${fixture.name} water containment`).toBeTrue();
      expect(fixture.volume.sample(fixture.above, 0).location)
        .withContext(`${fixture.name} above`).toBe('above-surface');
      expect(fixture.volume.sample(fixture.below, 0).location)
        .withContext(`${fixture.name} below`).toBe('below-bottom');
    }
  });

  it('reports land when the terrain surface reaches the water surface', () => {
    const cases = [
      {
        name: 'plane',
        terrain: new TerrainAnimalWorldSurface(new ConstantTerrainField(0), new PlaneTerrainDomain(100)),
        domain: new PlaneWaterDomain(),
        point: { x: 0, y: 0, z: 0 },
      },
      {
        name: 'sphere',
        terrain: new TerrainAnimalWorldSurface(new ConstantTerrainField(0), new SphereTerrainDomain(100)),
        domain: new SphereWaterDomain(100),
        point: { x: 100, y: 0, z: 0 },
      },
      {
        name: 'cylinder',
        terrain: new TerrainAnimalWorldSurface(
          new ConstantTerrainField(0),
          new CylinderTerrainDomain({ radiusM: 50, lengthM: 100 }),
        ),
        domain: new CylinderWaterDomain(50, { axis: new Vector3(1, 0, 0), lengthM: 100 }),
        point: { x: 0, y: 50, z: 0 },
      },
    ];
    for (const testCase of cases) {
      const volume = new TerrainWaterAnimalVolume({
        terrain: testCase.terrain,
        bodies: [body(testCase.domain)],
      });
      expect(volume.sample(testCase.point, 0).location).withContext(testCase.name).toBe('land');
      expect(volume.sample(testCase.point, 0).land).withContext(testCase.name).toBeTrue();
    }
  });

  it('distinguishes a dry footprint and samples valid and invalid segments', () => {
    for (const fixture of makeFixtures()) {
      const dry = new TerrainWaterAnimalVolume({
        terrain: fixture.terrain,
        bodies: [body(
          fixture.waterDomain,
          () => false,
        )],
      });
      expect(dry.sample(fixture.water, 0).location).withContext(`${fixture.name} dry`).toBe('dry');
      expect(fixture.volume.isSegmentValid(fixture.tangentFrom, fixture.tangentTo, 0, 2))
        .withContext(`${fixture.name} valid segment`).toBeTrue();
      expect(fixture.volume.isSegmentValid(fixture.water, fixture.above, 0, 2))
        .withContext(`${fixture.name} invalid segment`).toBeFalse();
    }
  });

  it('moves along each selected water surface while preserving the body selection', () => {
    for (const fixture of makeFixtures()) {
      const moved = fixture.volume.moveAlongSurface(
        fixture.water,
        fixture.tangentTo,
        1,
        0,
      );

      expect(moved).withContext(`${fixture.name} moved surface`).toBeDefined();
      expect(moved!.bodyId).withContext(`${fixture.name} body`).toBe('test-sea');
      expect(fixture.volume.sample(moved!.position, 0).containsWater)
        .withContext(`${fixture.name} moved containment`).toBeTrue();

      if (fixture.name === 'plane') {
        expect(moved!.position.x).toBeCloseTo(4, 6);
        expect(moved!.position.y).toBeCloseTo(0, 6);
        expect(moved!.position.z).toBeCloseTo(0, 6);
      } else if (fixture.name === 'sphere') {
        expect(Math.hypot(moved!.position.x, moved!.position.y, moved!.position.z))
          .toBeCloseTo(100, 6);
      } else {
        expect(Math.hypot(moved!.position.y, moved!.position.z)).toBeCloseTo(50, 6);
      }
    }
  });

  it('keeps large non-origin plane coordinates local while moving along the surface', () => {
    const fixture = makeFixtures().find(candidate => candidate.name === 'plane')!;
    const start = { x: -12345, y: -5, z: 6789 };
    const moved = fixture.volume.moveAlongSurface(start, { x: 4, y: 0, z: -3 }, 1, 0);

    expect(moved).toBeDefined();
    expect(moved!.bodyId).toBe('test-sea');
    expect(moved!.position.x).toBeCloseTo(start.x + 4, 6);
    expect(moved!.position.y).toBeCloseTo(0, 6);
    expect(moved!.position.z).toBeCloseTo(start.z - 3, 6);
    expect(fixture.volume.sample(moved!.position, 0).containsWater).toBeTrue();
  });

  it('crosses the cylinder angular seam continuously', () => {
    const fixture = makeFixtures().find(candidate => candidate.name === 'cylinder')!;
    const moved = fixture.volume.moveAlongSurface(
      fixture.water,
      { x: 0, y: 0, z: 200 },
      1,
      0,
    );

    expect(moved).toBeDefined();
    expect(moved!.bodyId).toBe('test-sea');
    expect(moved!.position.x).toBeCloseTo(0, 6);
    expect(moved!.position.y).toBeCloseTo(50 * Math.cos(4), 6);
    expect(moved!.position.z).toBeCloseTo(50 * Math.sin(4), 6);
    expect(fixture.volume.sample(moved!.position, 0).containsWater).toBeTrue();
  });

  it('retains the selected body when overlapping bodies share a surface', () => {
    const fixture = makeFixtures()[0];
    const volume = new TerrainWaterAnimalVolume({
      terrain: fixture.terrain,
      bodies: [
        body(fixture.waterDomain, () => true, 'primary', 10),
        body(fixture.waterDomain, () => true, 'fallback', 0),
      ],
    });

    const moved = volume.moveAlongSurface(fixture.water, { x: 4, y: 0, z: 0 }, 1, 0);
    expect(moved?.bodyId).toBe('primary');
  });

  it('returns undefined when movement leaves the selected body footprint', () => {
    const fixture = makeFixtures()[0];
    const volume = new TerrainWaterAnimalVolume({
      terrain: fixture.terrain,
      bodies: [body(fixture.waterDomain, position => position.x <= 1)],
    });

    expect(volume.moveAlongSurface(fixture.water, { x: 4, y: 0, z: 0 }, 1, 0))
      .toBeUndefined();
  });
});
