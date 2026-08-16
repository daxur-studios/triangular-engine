import {
  sampleAnimalAirFlockCycle,
  type AnimalAirFlockCycleDefinition,
} from './animal-air-flock-cycle';
import type { AnimalAirFlockPolicyDefinition } from './animal-air-flock-policy';
import type { AnimalVector3 } from './animal-types';
import type { AnimalWorldSurface, AnimalWorldSurfaceSample } from './animal-world-surface';

describe('animal air-flock cycle', () => {
  it('maps arbitrarily large positive and negative Universal Times to the same local cycle state', () => {
    const definition = cycleDefinition();
    const localTime = 5.5;
    const duration = 12;
    const baseline = sampleAnimalAirFlockCycle(localTime, definition);
    const future = sampleAnimalAirFlockCycle(localTime + duration * 1_000_000_000, definition);
    const past = sampleAnimalAirFlockCycle(localTime - duration * 1_000_000_000, definition);

    expect(comparableSample(future)).toEqual(comparableSample(baseline));
    expect(comparableSample(past)).toEqual(comparableSample(baseline));
    expect(future.cycleIndex).toBe(1_000_000_000);
    expect(past.cycleIndex).toBe(-1_000_000_000);
  });

  it('repeats exactly and depends only on the requested time rather than elapsed call history', () => {
    const definition = cycleDefinition();
    const expected = sampleAnimalAirFlockCycle(7.25, definition);

    sampleAnimalAirFlockCycle(-99_999_999, definition);
    sampleAnimalAirFlockCycle(0, definition);
    sampleAnimalAirFlockCycle(123_456_789, definition);
    const replayed = sampleAnimalAirFlockCycle(7.25, definition);

    expect(replayed).toEqual(expected);
  });

  it('reports the three phases at their explicit cycle boundaries', () => {
    const definition = cycleDefinition();

    expect(sampleAnimalAirFlockCycle(0, definition).phase).toBe('roosting');
    expect(sampleAnimalAirFlockCycle(1.999, definition).phase).toBe('roosting');
    expect(sampleAnimalAirFlockCycle(2, definition).phase).toBe('flying');
    expect(sampleAnimalAirFlockCycle(7.999, definition).phase).toBe('flying');
    expect(sampleAnimalAirFlockCycle(8, definition).phase).toBe('returning');
    expect(sampleAnimalAirFlockCycle(11.999, definition).phase).toBe('returning');
    expect(sampleAnimalAirFlockCycle(12, definition).phase).toBe('roosting');
  });

  it('bounds reconstruction work to one configured cycle, independent of the Universal-Time magnitude', () => {
    const definition = cycleDefinition({ fixedStepSeconds: 0.5, maximumReplaySteps: 24 });
    const local = sampleAnimalAirFlockCycle(11.9, definition);
    const farFuture = sampleAnimalAirFlockCycle(11.9 + 12 * 999_999_999, definition);

    expect(local.replaySteps).toBe(24);
    expect(farFuture.replaySteps).toBe(24);
    expect(farFuture.replaySteps).toBeLessThanOrEqual(definition.maximumReplaySteps);
  });

  it('rejects a direct cycle whose flock cannot all be assigned a roost slot', () => {
    const definition = cycleDefinition({
      memberCount: 3,
      roostSites: [{ id: 'small-tree', position: { x: 0, y: 3, z: 0 }, capacity: 2 }],
    });

    expect(() => sampleAnimalAirFlockCycle(0, definition)).toThrowError(/requires roost capacity/i);
  });

  it('rejects invalid time, group bounds, durations, and replay bounds before simulation', () => {
    expect(() => sampleAnimalAirFlockCycle(Number.NaN, cycleDefinition())).toThrowError(/Universal Time/i);
    expect(() => sampleAnimalAirFlockCycle(0, cycleDefinition({ groupId: '' }))).toThrowError(/group and member count/i);
    expect(() => sampleAnimalAirFlockCycle(0, cycleDefinition({ memberCount: 9 }))).toThrowError(/group and member count/i);
    expect(() => sampleAnimalAirFlockCycle(0, cycleDefinition({ flightDurationS: 0 }))).toThrowError(/durations and work limits/i);
    expect(() => sampleAnimalAirFlockCycle(0, cycleDefinition({ fixedStepSeconds: Number.POSITIVE_INFINITY })))
      .toThrowError(/durations and work limits/i);
    expect(() => sampleAnimalAirFlockCycle(0, cycleDefinition({ maximumReplaySteps: 0 }))).toThrowError(/durations and work limits/i);
    expect(() => sampleAnimalAirFlockCycle(0, cycleDefinition({ fixedStepSeconds: 1, maximumReplaySteps: 11 })))
      .toThrowError(/cannot fit within its bounded replay-step limit/i);
  });
});

function cycleDefinition(overrides: Partial<AnimalAirFlockCycleDefinition> = {}): AnimalAirFlockCycleDefinition {
  return {
    groupId: 'coastal-swallows', memberCount: 2,
    roostSites: [
      { id: 'tree-a', position: { x: 0, y: 3, z: 0 }, capacity: 1 },
      { id: 'tree-b', position: { x: 3, y: 3, z: 0 }, capacity: 1 },
    ],
    flightTarget: { x: 20, y: 4, z: 8 },
    roostDurationS: 2, flightDurationS: 6, returnDurationS: 4,
    fixedStepSeconds: 1, maximumReplaySteps: 12, policy: policy(),
    ...overrides,
  };
}

function policy(): AnimalAirFlockPolicyDefinition {
  return {
    surface: flatSurface(), maximumMembers: 8, maximumRoostSites: 4,
    maximumSpeedMps: 8, maximumAccelerationMps2: 16, maximumSubstepDistanceM: 20, maximumSubsteps: 4,
    minimumAltitudeM: 1, maximumAltitudeM: 10, preferredAltitudeM: 3,
    separationRadiusM: 2, separationWeight: 1, cohesionWeight: 1, alignmentWeight: 1, targetWeight: 4,
    arrivalRadiusM: 0.5, holdingRadiusM: 5, holdingSpeedMps: 1, roostSlotSpacingM: 2,
  };
}

function comparableSample(sample: ReturnType<typeof sampleAnimalAirFlockCycle>) {
  return {
    cycleTimeS: sample.cycleTimeS, cycleDurationS: sample.cycleDurationS,
    phase: sample.phase, replaySteps: sample.replaySteps, members: sample.members,
  };
}

function flatSurface(): AnimalWorldSurface {
  return {
    kind: 'plane', sample: position => sample(position),
    projectToSurface: position => ({ x: position.x, y: 0, z: position.z }),
    moveAlongSurface: (position, velocity, seconds) => ({
      x: position.x + velocity.x * seconds, y: 0, z: position.z + velocity.z * seconds,
    }),
    surfaceDistance: (from, to) => Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z),
  };
}

function sample(position: AnimalVector3): AnimalWorldSurfaceSample {
  const ground = { x: position.x, y: 0, z: position.z };
  return {
    position: ground, anchorRelativePosition: ground, normal: { x: 0, y: 1, z: 0 },
    surfaceUp: { x: 0, y: 1, z: 0 }, tangentU: { x: 1, y: 0, z: 0 }, tangentV: { x: 0, y: 0, z: 1 },
    elevationM: 0, slope01: 0, walkable: true,
  };
}
