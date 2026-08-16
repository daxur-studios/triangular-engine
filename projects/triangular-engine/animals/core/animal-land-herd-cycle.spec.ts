import {
  sampleAnimalLandHerdCycle,
  selectAnimalGrazingPatch,
  type AnimalLandHerdCycleDefinition,
} from './animal-land-herd-cycle';
import type { AnimalGrazingPatch, AnimalLandHerdPolicyDefinition } from './animal-land-herd-policy';
import type { AnimalVector3 } from './animal-types';
import type { AnimalWorldSurface, AnimalWorldSurfaceSample } from './animal-world-surface';

describe('animal land-herd cycle', () => {
  it('reconstructs the same requested time independently of call history', () => {
    const definition = cycleDefinition();
    const expected = sampleAnimalLandHerdCycle(7.25, definition);

    sampleAnimalLandHerdCycle(-99_999_999, definition);
    sampleAnimalLandHerdCycle(0, definition);
    sampleAnimalLandHerdCycle(123_456_789, definition);

    expect(sampleAnimalLandHerdCycle(7.25, definition)).toEqual(expected);
  });

  it('maps large positive and negative Universal Times to one bounded local cycle', () => {
    const definition = cycleDefinition();
    const localTime = 5.5;
    const duration = 12;
    const baseline = sampleAnimalLandHerdCycle(localTime, definition);
    const future = sampleAnimalLandHerdCycle(localTime + duration * 1_000_000_000, definition);
    const past = sampleAnimalLandHerdCycle(localTime - duration * 1_000_000_000, definition);

    expect(comparable(future)).toEqual(comparable(baseline));
    expect(comparable(past)).toEqual(comparable(baseline));
    expect(future.cycleIndex).toBe(1_000_000_000);
    expect(past.cycleIndex).toBe(-1_000_000_000);
    expect(future.replaySteps).toBeLessThanOrEqual(definition.maximumReplaySteps);
    expect(past.replaySteps).toBeLessThanOrEqual(definition.maximumReplaySteps);
  });

  it('reports the four explicit phase boundaries', () => {
    const definition = cycleDefinition();

    expect(sampleAnimalLandHerdCycle(0, definition).phase).toBe('resting');
    expect(sampleAnimalLandHerdCycle(1.999, definition).phase).toBe('resting');
    expect(sampleAnimalLandHerdCycle(2, definition).phase).toBe('outbound-travel');
    expect(sampleAnimalLandHerdCycle(4.999, definition).phase).toBe('outbound-travel');
    expect(sampleAnimalLandHerdCycle(5, definition).phase).toBe('grazing');
    expect(sampleAnimalLandHerdCycle(8.999, definition).phase).toBe('grazing');
    expect(sampleAnimalLandHerdCycle(9, definition).phase).toBe('return-travel');
    expect(sampleAnimalLandHerdCycle(11.999, definition).phase).toBe('return-travel');
    expect(sampleAnimalLandHerdCycle(12, definition).phase).toBe('resting');
  });

  it('does not apply the newly entered phase before any of its time has elapsed', () => {
    const definition = cycleDefinition();
    const initialRest = sampleAnimalLandHerdCycle(0, definition);
    const outboundBoundary = sampleAnimalLandHerdCycle(definition.restDurationS, definition);

    expect(outboundBoundary.phase).toBe('outbound-travel');
    expect(outboundBoundary.members).toEqual(initialRest.members);
    expect(outboundBoundary.members.every(member => member.mode === 'rest' && member.velocity.x === 0)).toBeTrue();
  });

  it('selects a cycle-index patch independently of grazing-patch input order', () => {
    const definition = cycleDefinition({
      grazingPatches: [patch('ridge', 16, 0.8, 4), patch('meadow', 12, 0.9, 4), patch('brook', 8, 0.7, 4)],
    });
    const reversed = { ...definition, grazingPatches: [...definition.grazingPatches].reverse() };

    for (const cycleIndex of [-4, -1, 0, 1, 5]) {
      const direct = selectAnimalGrazingPatch(definition.groupSeed, cycleIndex, definition.homePatch,
        definition.grazingPatches, definition.policy, definition.memberCount);
      const reordered = selectAnimalGrazingPatch(definition.groupSeed, cycleIndex, definition.homePatch,
        reversed.grazingPatches, reversed.policy, reversed.memberCount);
      const atCycle = sampleAnimalLandHerdCycle(cycleIndex * 12 + 5, definition);

      expect(reordered?.id).toBe(direct?.id);
      expect(atCycle.selectedGrazingPatchId).toBe(direct?.id);
    }
  });

  it('remains resting when no viable grazing patch exists', () => {
    const definition = cycleDefinition({
      grazingPatches: [patch('closed', 10, 1, 4, false), patch('too-small', 12, 1, 1)],
    });
    const sample = sampleAnimalLandHerdCycle(6, definition);

    expect(sample.phase).toBe('resting');
    expect(sample.selectedGrazingPatchId).toBeUndefined();
    expect(sample.members.every(member => member.mode === 'rest' && member.patchId === 'home')).toBeTrue();
  });

  it('requires enough viable home capacity to directly reconstruct every member', () => {
    const definition = cycleDefinition({ memberCount: 3, homePatch: patch('home', 0, 1, 2) });

    expect(() => sampleAnimalLandHerdCycle(0, definition)).toThrowError(/requires home capacity/i);
  });

  it('rejects invalid identities, durations, and replay work limits before stepping', () => {
    expect(() => sampleAnimalLandHerdCycle(Number.NaN, cycleDefinition())).toThrowError(/identity or time/i);
    expect(() => sampleAnimalLandHerdCycle(0, cycleDefinition({ groupId: '' }))).toThrowError(/identity or time/i);
    expect(() => sampleAnimalLandHerdCycle(0, cycleDefinition({ groupSeed: 0.5 }))).toThrowError(/identity or time/i);
    expect(() => sampleAnimalLandHerdCycle(0, cycleDefinition({ memberCount: 9 }))).toThrowError(/identity or time/i);
    expect(() => sampleAnimalLandHerdCycle(0, cycleDefinition({ restDurationS: 0 }))).toThrowError(/work bounds/i);
    expect(() => sampleAnimalLandHerdCycle(0, cycleDefinition({ fixedStepSeconds: Number.POSITIVE_INFINITY }))).toThrowError(/work bounds/i);
    expect(() => sampleAnimalLandHerdCycle(0, cycleDefinition({ maximumReplaySteps: 0 }))).toThrowError(/work bounds/i);
    expect(() => sampleAnimalLandHerdCycle(0, cycleDefinition({ fixedStepSeconds: 1, maximumReplaySteps: 11 }))).toThrowError(/work bounds/i);
  });
});

function cycleDefinition(overrides: Partial<AnimalLandHerdCycleDefinition> = {}): AnimalLandHerdCycleDefinition {
  return {
    groupId: 'plains-zebra', groupSeed: 42, memberCount: 2,
    homePatch: patch('home', 0, 1, 2),
    grazingPatches: [patch('meadow', 12, 0.9, 4)],
    restDurationS: 2, outboundTravelDurationS: 3, grazeDurationS: 4, returnTravelDurationS: 3,
    fixedStepSeconds: 1, maximumReplaySteps: 12, policy: policy(),
    ...overrides,
  };
}

function policy(): AnimalLandHerdPolicyDefinition {
  return {
    surface: flatSurface(), maximumMembers: 8, maximumPatches: 8,
    maximumSpeedMps: 4, maximumAccelerationMps2: 16, maximumSubstepDistanceM: 20, maximumSubsteps: 4,
    maximumSlope01: 0.5, maximumPatchDistanceM: 50, minimumPatchSuitability01: 0.5,
    separationRadiusM: 0, separationWeight: 0, cohesionWeight: 0, alignmentWeight: 0, targetWeight: 1,
    arrivalRadiusM: 0.1, slotSpacingM: 2, maximumAvoidanceAttempts: 3,
  };
}

function patch(id: string, x: number, suitability01: number, capacity: number, available = true): AnimalGrazingPatch {
  return { id, position: { x, y: 0, z: 0 }, radiusM: 4, capacity, suitability01, available };
}

function comparable(sample: ReturnType<typeof sampleAnimalLandHerdCycle>) {
  return { cycleTimeS: sample.cycleTimeS, cycleDurationS: sample.cycleDurationS, phase: sample.phase,
    selectedGrazingPatchId: sample.selectedGrazingPatchId, replaySteps: sample.replaySteps, members: sample.members };
}

function flatSurface(): AnimalWorldSurface {
  return {
    kind: 'plane', sample: position => surfaceSample(position),
    projectToSurface: position => ({ x: position.x, y: 0, z: position.z }),
    moveAlongSurface: (position, velocity, seconds) => ({ x: position.x + velocity.x * seconds, y: 0, z: position.z + velocity.z * seconds }),
    surfaceDistance: (from, to) => Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z),
  };
}

function surfaceSample(position: AnimalVector3): AnimalWorldSurfaceSample {
  const ground = { x: position.x, y: 0, z: position.z };
  return { position: ground, anchorRelativePosition: ground, normal: { x: 0, y: 1, z: 0 },
    surfaceUp: { x: 0, y: 1, z: 0 }, tangentU: { x: 1, y: 0, z: 0 }, tangentV: { x: 0, y: 0, z: 1 },
    elevationM: 0, slope01: 0, walkable: true };
}
