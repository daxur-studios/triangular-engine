import '@angular/compiler';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';

const [animals, animalTerrain, animalWater, terrain, water] = await Promise.all([
  import('../dist/triangular-engine/fesm2022/triangular-engine-animals.mjs'),
  import('../dist/triangular-engine/fesm2022/triangular-engine-animals-terrain.mjs'),
  import('../dist/triangular-engine/fesm2022/triangular-engine-animals-water.mjs'),
  import('../dist/triangular-engine/fesm2022/triangular-engine-terrain.mjs'),
  import('../dist/triangular-engine/fesm2022/triangular-engine-water.mjs'),
]);
const { allocateAnimalAquaticZones, resolveAnimalAquaticZonePosition, sampleAnimalAquaticSchoolCycle, stepAnimalAquaticSchool } = animals;
const { TerrainAnimalWorldSurface } = animalTerrain;
const { TerrainWaterAnimalVolume } = animalWater;
const { ConstantTerrainField, PlaneTerrainDomain, SphereTerrainDomain, CylinderTerrainDomain } = terrain;
const { PlaneWaterDomain, SphereWaterDomain, CylinderWaterDomain } = water;
const flatWater = { getHeight: () => 0, getNormal: (_x, _z, _time, out = new Vector3()) => out.set(0, 1, 0), getFlow: (_x, _z, _time, out = new Vector3()) => out.set(0.35, 0, 0) };
const seam = Math.PI * 2 - 0.025;
const fixtures = [
  { name: 'plane', surface: new TerrainAnimalWorldSurface(new ConstantTerrainField(-10), new PlaneTerrainDomain(100)), waterDomain: new PlaneWaterDomain(), start: { x: -140, y: -5, z: 60 } },
  { name: 'sphere', surface: new TerrainAnimalWorldSurface(new ConstantTerrainField(-10), new SphereTerrainDomain(100)), waterDomain: new SphereWaterDomain(100), start: scale({ x: 1, y: 1, z: 0 }, 95 / Math.sqrt(2)) },
  { name: 'cylinder', surface: new TerrainAnimalWorldSurface(new ConstantTerrainField(-10), new CylinderTerrainDomain({ radiusM: 50, lengthM: 200 })), waterDomain: new CylinderWaterDomain(50, { axis: new Vector3(1, 0, 0), lengthM: 200 }), start: { x: 0, y: 55 * Math.cos(seam), z: 55 * Math.sin(seam) } },
];
const report = {};
for (const fixture of fixtures) {
  const volume = new TerrainWaterAnimalVolume({ terrain: fixture.surface, bodies: [{ body: { id: 'sea', domain: fixture.waterDomain, surface: flatWater } }] });
  const startSample = volume.sample(fixture.start, 0);
  assert.ok(startSample.containsWater && startSample.bottom && startSample.surface);
  const tangent = startSample.bottom.tangentV;
  const targetSurface = volume.moveAlongSurface(fixture.start, scale(tangent, 8), 1, 0);
  assert.ok(targetSurface);
  const target = add(targetSurface.position, scale(targetSurface.normal, -5));
  assert.ok(volume.surfaceDistance(fixture.start, target) > 7.5 && volume.surfaceDistance(fixture.start, target) < 8.5,
    `${fixture.name}: water surface transport was not local`);
  const homeZone = { id: 'home-water', position: fixture.start, radiusM: 2.5, capacity: 8, suitability01: 1 };
  const forageZone = { id: 'forage-water', position: target, radiusM: 2.5, capacity: 8, suitability01: 0.9 };
  const definition = {
    water: volume, maximumMembers: 12, maximumZones: 4, maximumZoneDistanceM: 30,
    minimumZoneSuitability01: 0.3, maximumSpeedMps: 2.5, maximumAccelerationMps2: 4,
    maximumSubstepDistanceM: 0.3, maximumSubsteps: 8,
    minimumSurfaceClearanceM: 1, minimumBottomClearanceM: 1,
    preferredSurfaceClearanceM: 5, maximumSurfaceClearanceM: 7,
    segmentSampleSpacingM: 0.25, separationRadiusM: 1.2, separationWeight: 2,
    cohesionWeight: 0.7, alignmentWeight: 0.2, targetWeight: 4,
    flowWeight: 0.15, depthWeight: 1.5, arrivalRadiusM: 0.3,
    slotSpacingM: 0.75, maximumAvoidanceAttempts: 4,
  };
  const ids = Array.from({ length: 8 }, (_, index) => `fish-${index}`);
  let members = ids.map((id, index) => ({
    id, position: resolveAnimalAquaticZonePosition(homeZone, index, 0, definition),
    velocity: { x: 0, y: 0, z: 0 }, mode: 'rest', zoneId: homeZone.id,
  }));
  const forward = allocateAnimalAquaticZones(ids, [forageZone], target, 0, definition);
  const reversed = allocateAnimalAquaticZones([...ids].reverse(), [forageZone], target, 0, definition);
  assert.deepEqual(forward, reversed, `${fixture.name}: zone allocation order changed result`);
  for (let tick = 0; tick < 100; tick++) {
    const result = stepAnimalAquaticSchool({ members, intent: 'travel', target, deltaSeconds: 0.1, universalTime: tick * 0.1 }, definition);
    assert.ok(result.constrained.every(value => !value.blocked), `${fixture.name}: school travel blocked`);
    members = result.members; assertSafe(volume, members, tick * 0.1, definition);
  }
  for (let tick = 0; tick < 200; tick++) {
    const result = stepAnimalAquaticSchool({ members, intent: 'forage', target, zones: [forageZone], deltaSeconds: 0.1, universalTime: 10 + tick * 0.1 }, definition);
    assert.ok(result.constrained.every(value => !value.blocked), `${fixture.name}: school forage blocked`);
    members = result.members; assertSafe(volume, members, 10 + tick * 0.1, definition);
  }
  assert.ok(members.every(member => member.mode === 'forage' && magnitude(member.velocity) === 0), `${fixture.name}: forage did not settle ${JSON.stringify({ start: fixture.start, target, slots: ids.map((_, index) => resolveAnimalAquaticZonePosition(forageZone, index, 30, definition)), members: members.map(member => ({ mode: member.mode, speed: magnitude(member.velocity), position: member.position, distance: volume.surfaceDistance(member.position, target) })) })}`);
  members = stepAnimalAquaticSchool({ members, intent: 'rest', target, zones: [forageZone], deltaSeconds: 0.1, universalTime: 31 }, definition).members;
  assert.ok(members.every(member => member.mode === 'rest' && magnitude(member.velocity) === 0), `${fixture.name}: aquatic rest moved`);
  const blockSurface = volume.moveAlongSurface(fixture.start, scale(tangent, 0.16), 1, 0);
  const blockedWater = blockedWrapper(volume, add(blockSurface.position, scale(blockSurface.normal, -5)), 0.08);
  const probeDefinition = { ...definition, water: blockedWater };
  const probe = { id: 'probe', position: fixture.start, velocity: { x: 0, y: 0, z: 0 }, mode: 'travel' };
  const detour = stepAnimalAquaticSchool({ members: [probe], intent: 'travel', target, deltaSeconds: 0.2, universalTime: 0 }, probeDefinition);
  assert.equal(detour.constrained[0].blocked, false, `${fixture.name}: local water detour failed`);
  assertSafe(volume, detour.members, 0.2, definition);
  const cycleDefinition = {
    groupId: `${fixture.name}-school`, groupSeed: 73, memberCount: 8,
    homeZone, feedingZones: [forageZone], schoolingDurationS: 5,
    outboundDurationS: 10, feedingDurationS: 10, returnDurationS: 15,
    fixedStepSeconds: 0.1, maximumReplaySteps: 400, policy: definition,
  };
  const direct = sampleAnimalAquaticSchoolCycle(17.25, cycleDefinition);
  assert.deepEqual(direct, sampleAnimalAquaticSchoolCycle(17.25, cycleDefinition), `${fixture.name}: direct cycle not deterministic`);
  const future = sampleAnimalAquaticSchoolCycle(1_000_000_017.25, cycleDefinition);
  const past = sampleAnimalAquaticSchoolCycle(-1_000_022.75, cycleDefinition);
  assert.ok(future.replaySteps <= 400 && past.replaySteps <= 400, `${fixture.name}: distant aquatic query exceeded work bound`);
  assertSafe(volume, [...direct.members, ...future.members, ...past.members], 17.25, definition);
  const closing = sampleAnimalAquaticSchoolCycle(39.9, cycleDefinition);
  assert.ok(closing.members.every(member => member.mode === 'rest'), `${fixture.name}: aquatic cycle did not close at home`);
  const noFeeding = sampleAnimalAquaticSchoolCycle(17.25, {
    ...cycleDefinition, policy: { ...definition, minimumZoneSuitability01: 0.99 },
  });
  assert.equal(noFeeding.phase, 'home-schooling');
  assert.ok(noFeeding.members.every(member => member.mode === 'rest'));
  report[fixture.name] = { sameWaterBody: true, surfaceBottomDepthBand: true, deterministicZoneAllocation: true, forageSettles: true, restingStill: true, localShoreDetour: true, directUniversalTime: true, boundedDistantQueries: true };
}
console.log(JSON.stringify({ passed: true, shapes: report }, null, 2));

function blockedWrapper(base, center, radius) { return { sample: (...args) => base.sample(...args), moveAlongSurface: (...args) => base.moveAlongSurface(...args), surfaceDistance: (...args) => base.surfaceDistance(...args), isSegmentValid(from, to, time, spacing) { return base.isSegmentValid(from, to, time, spacing) && base.surfaceDistance(to, center) > radius; } }; }
function assertSafe(volume, members, time, definition) { for (const member of members) { const sample = volume.sample(member.position, time); assert.equal(sample.containsWater, true); assert.equal(sample.surface?.bodyId, 'sea'); assert.ok(sample.surfaceClearanceM >= definition.minimumSurfaceClearanceM - 1e-6); assert.ok(sample.surfaceClearanceM <= definition.maximumSurfaceClearanceM + 1e-6); assert.ok(sample.bottomClearanceM >= definition.minimumBottomClearanceM - 1e-6); } }
function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function scale(value, amount) { return { x: value.x * amount, y: value.y * amount, z: value.z * amount }; }
function magnitude(value) { return Math.hypot(value.x, value.y, value.z); }
