import '@angular/compiler';
import assert from 'node:assert/strict';

const [animals, animalTerrain, terrain] = await Promise.all([
  import('../dist/triangular-engine/fesm2022/triangular-engine-animals.mjs'),
  import('../dist/triangular-engine/fesm2022/triangular-engine-animals-terrain.mjs'),
  import('../dist/triangular-engine/fesm2022/triangular-engine-terrain.mjs'),
]);
const { allocateAnimalHerdPatches, sampleAnimalLandHerdCycle, stepAnimalLandHerd } = animals;
const { TerrainAnimalWorldSurface } = animalTerrain;
const { ConstantTerrainField, PlaneTerrainDomain, SphereTerrainDomain, CylinderTerrainDomain } = terrain;
const fixtures = [
  { name: 'plane', surface: new TerrainAnimalWorldSurface(new ConstantTerrainField(0), new PlaneTerrainDomain(100)), query: { x: -140, y: 0, z: 60 } },
  { name: 'sphere', surface: new TerrainAnimalWorldSurface(new ConstantTerrainField(0), new SphereTerrainDomain(100)), query: { x: 70, y: 70, z: 0 } },
  { name: 'cylinder', surface: new TerrainAnimalWorldSurface(new ConstantTerrainField(0), new CylinderTerrainDomain({ radiusM: 50, lengthM: 200 })), query: { x: 0, y: 49.99, z: -1 } },
];
const report = {};
for (const fixture of fixtures) {
  const origin = fixture.surface.sample(fixture.query);
  const target = fixture.surface.sample(fixture.surface.moveAlongSurface(origin.position, scale(origin.tangentU, 10), 1)).position;
  const patchCenters = [-3, 3].map(value => fixture.surface.sample(fixture.surface.moveAlongSurface(
    target, scale(origin.tangentV, value), 1)).position);
  const patches = [
    { id: 'pasture-b', position: patchCenters[1], radiusM: 2.5, capacity: 4, suitability01: 0.8 },
    { id: 'pasture-a', position: patchCenters[0], radiusM: 2.5, capacity: 4, suitability01: 0.9 },
  ];
  const definition = {
    surface: fixture.surface, maximumMembers: 12, maximumPatches: 4,
    maximumSpeedMps: 2.5, maximumAccelerationMps2: 4,
    maximumSubstepDistanceM: 0.3, maximumSubsteps: 8, maximumSlope01: 0.6,
    maximumPatchDistanceM: 30, minimumPatchSuitability01: 0.3,
    separationRadiusM: 1.3, separationWeight: 2, cohesionWeight: 0.7,
    alignmentWeight: 0.2, targetWeight: 4, arrivalRadiusM: 0.3,
    slotSpacingM: 0.8, maximumAvoidanceAttempts: 4,
  };
  let members = Array.from({ length: 8 }, (_, index) => {
    const angle = index / 8 * Math.PI * 2;
    const position = fixture.surface.sample(fixture.surface.moveAlongSurface(origin.position, add(
      scale(origin.tangentU, Math.cos(angle)), scale(origin.tangentV, Math.sin(angle))), 1)).position;
    return { id: `herd-${index}`, position, velocity: { x: 0, y: 0, z: 0 }, mode: 'travel' };
  });
  const forward = allocateAnimalHerdPatches(members.map(value => value.id), patches, target, fixture.surface, 4, 30, 0.3, 0.6);
  const reversed = allocateAnimalHerdPatches([...members].reverse().map(value => value.id), [...patches].reverse(), target, fixture.surface, 4, 30, 0.3, 0.6);
  assert.deepEqual(forward, reversed, `${fixture.name}: allocation order changed result`);
  assert.equal(forward.filter(value => value.mode === 'assigned').length, 8);
  for (let tick = 0; tick < 100; tick++) {
    const result = stepAnimalLandHerd({ members, intent: 'travel', target, deltaSeconds: 0.1, universalTime: tick * 0.1 }, definition);
    assert.ok(result.constrained.every(value => !value.blocked), `${fixture.name}: travel blocked`);
    members = result.members;
    assertOnSurface(fixture, members);
  }
  for (let tick = 0; tick < 200; tick++) {
    const result = stepAnimalLandHerd({ members, intent: 'graze', target, patches, deltaSeconds: 0.1, universalTime: 10 + tick * 0.1 }, definition);
    assert.ok(result.constrained.every(value => !value.blocked), `${fixture.name}: graze blocked`);
    members = result.members;
    assertOnSurface(fixture, members);
  }
  assert.ok(members.every(member => member.mode === 'graze'), `${fixture.name}: herd did not settle to graze`);
  assert.ok(members.every(member => magnitude(member.velocity) === 0), `${fixture.name}: grazing herd shuffled`);
  for (let tick = 0; tick < 10; tick++) {
    members = stepAnimalLandHerd({ members, intent: 'rest', target, patches, deltaSeconds: 0.1, universalTime: 30 + tick * 0.1 }, definition).members;
  }
  assert.ok(members.every(member => member.mode === 'rest' && magnitude(member.velocity) === 0), `${fixture.name}: rest was not still`);

  const blockedCenter = fixture.surface.sample(fixture.surface.moveAlongSurface(origin.position, scale(origin.tangentU, 0.35), 1)).position;
  const blockedSurface = blockedWrapper(fixture.surface, blockedCenter, 0.2);
  const blockedDefinition = { ...definition, surface: blockedSurface };
  const probe = { id: 'detour-probe', position: origin.position, velocity: { x: 0, y: 0, z: 0 }, mode: 'travel' };
  const detour = stepAnimalLandHerd({ members: [probe], intent: 'travel', target, deltaSeconds: 0.2, universalTime: 0 }, blockedDefinition);
  assert.equal(detour.constrained[0].blocked, false, `${fixture.name}: bounded local detour failed`);
  assert.equal(blockedSurface.sample(detour.members[0].position).walkable, true, `${fixture.name}: detour entered blocked terrain`);
  const homePatch = { id: 'home', position: origin.position, radiusM: 2.5, capacity: 8, suitability01: 1 };
  const cyclePatch = { id: 'cycle-pasture', position: target, radiusM: 3, capacity: 8, suitability01: 0.85 };
  const cycleDefinition = {
    groupId: `${fixture.name}-herd`, groupSeed: 91, memberCount: 8,
    homePatch, grazingPatches: [cyclePatch], restDurationS: 5,
    outboundTravelDurationS: 10, grazeDurationS: 10, returnTravelDurationS: 15,
    fixedStepSeconds: 0.1, maximumReplaySteps: 400, policy: definition,
  };
  const direct = sampleAnimalLandHerdCycle(17.25, cycleDefinition);
  assert.deepEqual(direct, sampleAnimalLandHerdCycle(17.25, cycleDefinition), `${fixture.name}: direct cycle not deterministic`);
  const future = sampleAnimalLandHerdCycle(1_000_000_017.25, cycleDefinition);
  const past = sampleAnimalLandHerdCycle(-1_000_022.75, cycleDefinition);
  assert.ok(future.replaySteps <= 400 && past.replaySteps <= 400, `${fixture.name}: distant time exceeded work bound`);
  assertOnSurface(fixture, [...direct.members, ...future.members, ...past.members]);
  const closing = sampleAnimalLandHerdCycle(39.9, cycleDefinition);
  assert.ok(closing.members.every(member => member.mode === 'rest'), `${fixture.name}: herd cycle did not close at home`);
  const noPasture = sampleAnimalLandHerdCycle(17.25, {
    ...cycleDefinition, policy: { ...definition, minimumPatchSuitability01: 0.99 },
  });
  assert.equal(noPasture.phase, 'resting');
  assert.ok(noPasture.members.every(member => member.mode === 'rest'));
  report[fixture.name] = { surfaceConstrained: true, deterministicPatchAllocation: true, grazingSettles: true, restingStill: true, localBlockedDetour: true, directUniversalTime: true, boundedDistantQueries: true };
}
console.log(JSON.stringify({ passed: true, shapes: report }, null, 2));

function blockedWrapper(base, center, radius) {
  return {
    kind: base.kind,
    sample(position, anchor) { const value = base.sample(position, anchor); return { ...value, walkable: value.walkable && base.surfaceDistance(value.position, center) > radius }; },
    projectToSurface: value => base.projectToSurface(value),
    moveAlongSurface: (position, velocity, seconds) => base.moveAlongSurface(position, velocity, seconds),
    surfaceDistance: (from, to) => base.surfaceDistance(from, to),
  };
}
function assertOnSurface(fixture, members) { for (const member of members) { const sample = fixture.surface.sample(member.position); assert.ok(distance(sample.position, member.position) < 1e-6); assert.equal(sample.walkable, true); } }
function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function scale(value, amount) { return { x: value.x * amount, y: value.y * amount, z: value.z * amount }; }
function magnitude(value) { return Math.hypot(value.x, value.y, value.z); }
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
