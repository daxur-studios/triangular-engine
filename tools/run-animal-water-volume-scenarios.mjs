import '@angular/compiler';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';

const [animalWater, animalTerrain, terrain, water] = await Promise.all([
  import('../dist/triangular-engine/fesm2022/triangular-engine-animals-water.mjs'),
  import('../dist/triangular-engine/fesm2022/triangular-engine-animals-terrain.mjs'),
  import('../dist/triangular-engine/fesm2022/triangular-engine-terrain.mjs'),
  import('../dist/triangular-engine/fesm2022/triangular-engine-water.mjs'),
]);

const { TerrainWaterAnimalVolume } = animalWater;
const { TerrainAnimalWorldSurface } = animalTerrain;
const { ConstantTerrainField, PlaneTerrainDomain, SphereTerrainDomain, CylinderTerrainDomain } = terrain;
const { PlaneWaterDomain, SphereWaterDomain, CylinderWaterDomain } = water;
const flatWater = {
  getHeight: () => 0,
  getNormal: (_x, _z, _time, out = new Vector3()) => out.set(0, 1, 0),
  getFlow: (_x, _z, _time, out = new Vector3()) => out.set(0.25, 0, -0.5),
};
const volume = (terrainSurface, domain, containsSurface) => new TerrainWaterAnimalVolume({
  terrain: terrainSurface,
  bodies: [{ body: { id: 'sea', domain, surface: flatWater }, containsSurface }],
});

const scenarios = [
  {
    shape: 'plane',
    volume: volume(
      new TerrainAnimalWorldSurface(new ConstantTerrainField(-10), new PlaneTerrainDomain(100)),
      new PlaneWaterDomain(),
    ),
    landVolume: volume(
      new TerrainAnimalWorldSurface(new ConstantTerrainField(0), new PlaneTerrainDomain(100)),
      new PlaneWaterDomain(),
    ),
    dryVolume: volume(
      new TerrainAnimalWorldSurface(new ConstantTerrainField(-10), new PlaneTerrainDomain(100)),
      new PlaneWaterDomain(),
      () => false,
    ),
    valid: { x: 0, y: -5, z: 0 }, above: { x: 0, y: 2, z: 0 }, below: { x: 0, y: -11, z: 0 },
    tangent: { x: 4, y: -5, z: 0 },
  },
  {
    shape: 'sphere',
    volume: volume(
      new TerrainAnimalWorldSurface(new ConstantTerrainField(-10), new SphereTerrainDomain(100)),
      new SphereWaterDomain(100),
    ),
    landVolume: volume(
      new TerrainAnimalWorldSurface(new ConstantTerrainField(0), new SphereTerrainDomain(100)),
      new SphereWaterDomain(100),
    ),
    dryVolume: volume(
      new TerrainAnimalWorldSurface(new ConstantTerrainField(-10), new SphereTerrainDomain(100)),
      new SphereWaterDomain(100),
      () => false,
    ),
    valid: { x: 95, y: 0, z: 0 }, above: { x: 102, y: 0, z: 0 }, below: { x: 89, y: 0, z: 0 },
    tangent: { x: 95, y: 3, z: 0 },
  },
  {
    shape: 'cylinder',
    volume: volume(
      new TerrainAnimalWorldSurface(
        new ConstantTerrainField(-10),
        new CylinderTerrainDomain({ radiusM: 50, lengthM: 100 }),
      ),
      new CylinderWaterDomain(50, { axis: new Vector3(1, 0, 0), lengthM: 100 }),
    ),
    landVolume: volume(
      new TerrainAnimalWorldSurface(
        new ConstantTerrainField(0),
        new CylinderTerrainDomain({ radiusM: 50, lengthM: 100 }),
      ),
      new CylinderWaterDomain(50, { axis: new Vector3(1, 0, 0), lengthM: 100 }),
    ),
    dryVolume: volume(
      new TerrainAnimalWorldSurface(
        new ConstantTerrainField(-10),
        new CylinderTerrainDomain({ radiusM: 50, lengthM: 100 }),
      ),
      new CylinderWaterDomain(50, { axis: new Vector3(1, 0, 0), lengthM: 100 }),
      () => false,
    ),
    valid: { x: 0, y: 55, z: 0 }, above: { x: 0, y: 48, z: 0 }, below: { x: 0, y: 61, z: 0 },
    tangent: { x: 4, y: 55, z: 0 },
  },
];

const report = {};
for (const scenario of scenarios) {
  const valid = scenario.volume.sample(scenario.valid, 100);
  assert.equal(valid.location, 'water', `${scenario.shape}: valid point`);
  assert.equal(scenario.volume.sample(scenario.above, 100).location, 'above-surface', `${scenario.shape}: above surface`);
  assert.equal(scenario.volume.sample(scenario.below, 100).location, 'below-bottom', `${scenario.shape}: below bottom`);
  assert.equal(scenario.volume.isSegmentValid(scenario.valid, scenario.tangent, 100, 1), true, `${scenario.shape}: valid segment`);
  assert.equal(scenario.volume.isSegmentValid(scenario.valid, scenario.above, 100, 1), false, `${scenario.shape}: surface crossing`);
  assert.equal(scenario.landVolume.sample(scenario.valid, 100).location, 'land', `${scenario.shape}: land`);
  assert.equal(scenario.dryVolume.sample(scenario.valid, 100).location, 'dry', `${scenario.shape}: dry footprint`);
  assert.ok(valid.surfaceClearanceM > 0 && valid.bottomClearanceM > 0, `${scenario.shape}: clearances`);
  report[scenario.shape] = {
    waterColumnDepthM: valid.waterColumnDepthM,
    surfaceClearanceM: valid.surfaceClearanceM,
    bottomClearanceM: valid.bottomClearanceM,
    rejectsAir: true,
    rejectsTerrain: true,
    rejectsLand: true,
    rejectsDryFootprint: true,
    rejectsCrossingSegment: true,
  };
}

console.log(JSON.stringify({ passed: true, shapes: report }, null, 2));
