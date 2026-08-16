import {
  sampleAnimalAquaticSchoolCycle,
  selectAnimalAquaticHabitat,
  type AnimalAquaticSchoolCycleDefinition,
} from './animal-aquatic-school-cycle';
import type { AnimalAquaticHabitatZone, AnimalAquaticSchoolPolicyDefinition } from './animal-aquatic-school-policy';
import type { AnimalVector3 } from './animal-types';
import type { AnimalWaterVolume, AnimalWaterVolumeSample } from './animal-water-volume';

describe('animal aquatic-school cycle', () => {
  it('reconstructs an exact requested time independently of call history', () => {
    const definition = cycleDefinition();
    const expected = sampleAnimalAquaticSchoolCycle(7.25, definition);

    sampleAnimalAquaticSchoolCycle(-99_999_999, definition);
    sampleAnimalAquaticSchoolCycle(0, definition);
    sampleAnimalAquaticSchoolCycle(123_456_789, definition);

    expect(sampleAnimalAquaticSchoolCycle(7.25, definition)).toEqual(expected);
  });

  it('maps huge positive and negative Universal Times to one bounded local cycle', () => {
    const definition = cycleDefinition();
    const localTime = 5.5;
    const duration = 12;
    const baseline = sampleAnimalAquaticSchoolCycle(localTime, definition);
    const future = sampleAnimalAquaticSchoolCycle(localTime + duration * 1_000_000_000, definition);
    const past = sampleAnimalAquaticSchoolCycle(localTime - duration * 1_000_000_000, definition);

    expect(comparable(future)).toEqual(comparable(baseline));
    expect(comparable(past)).toEqual(comparable(baseline));
    expect(future.cycleIndex).toBe(1_000_000_000);
    expect(past.cycleIndex).toBe(-1_000_000_000);
    expect(future.replaySteps).toBeLessThanOrEqual(definition.maximumReplaySteps);
    expect(past.replaySteps).toBeLessThanOrEqual(definition.maximumReplaySteps);
  });

  it('reports all four exact phase boundaries without stepping the newly entered phase early', () => {
    const definition = cycleDefinition();
    const resting = sampleAnimalAquaticSchoolCycle(0, definition);
    const outbound = sampleAnimalAquaticSchoolCycle(2, definition);
    const feeding = sampleAnimalAquaticSchoolCycle(5, definition);
    const returning = sampleAnimalAquaticSchoolCycle(9, definition);
    const nextCycle = sampleAnimalAquaticSchoolCycle(12, definition);

    expect(sampleAnimalAquaticSchoolCycle(1.999, definition).phase).toBe('home-schooling');
    expect(outbound.phase).toBe('outbound-foraging');
    expect(sampleAnimalAquaticSchoolCycle(4.999, definition).phase).toBe('outbound-foraging');
    expect(feeding.phase).toBe('feeding');
    expect(sampleAnimalAquaticSchoolCycle(8.999, definition).phase).toBe('feeding');
    expect(returning.phase).toBe('returning');
    expect(sampleAnimalAquaticSchoolCycle(11.999, definition).phase).toBe('returning');
    expect(nextCycle.phase).toBe('home-schooling');

    expect(outbound.members).toEqual(resting.members);
    expect(outbound.members.every(member => member.mode === 'rest')).toBeTrue();
    expect(feeding.members.every(member => member.mode === 'travel')).toBeTrue();
    expect(returning.members.every(member => member.mode === 'forage' || member.mode === 'approach')).toBeTrue();
    expect(nextCycle.members).toEqual(resting.members);
  });

  it('selects feeding habitat by cycle index independently of candidate input order', () => {
    const definition = cycleDefinition({
      feedingZones: [zone('shelf', 16, 0.8, 4), zone('kelp', 12, 0.9, 4), zone('reef', 8, 0.7, 4)],
    });
    const reversed = { ...definition, feedingZones: [...definition.feedingZones].reverse() };

    for (const cycleIndex of [-4, -1, 0, 1, 5]) {
      const direct = selectAnimalAquaticHabitat(definition.groupSeed, cycleIndex, definition.homeZone,
        definition.feedingZones, definition.memberCount, cycleIndex * 12, definition.policy);
      const reordered = selectAnimalAquaticHabitat(reversed.groupSeed, cycleIndex, reversed.homeZone,
        reversed.feedingZones, reversed.memberCount, cycleIndex * 12, reversed.policy);
      const atCycle = sampleAnimalAquaticSchoolCycle(cycleIndex * 12 + 5, definition);

      expect(reordered?.id).toBe(direct?.id);
      expect(atCycle.selectedFeedingZoneId).toBe(direct?.id);
    }
  });

  it('filters feeding candidates by body, suitability, capacity and range', () => {
    const definition = cycleDefinition({
      feedingZones: [
        zone('other-body', 13, 1, 4),
        zone('unsuitable', 11, 0.4, 4),
        zone('too-small', 12, 1, 1),
        zone('too-far', 80, 1, 4),
        zone('viable', 10, 0.8, 4),
      ],
    });

    expect(sampleAnimalAquaticSchoolCycle(5, definition).selectedFeedingZoneId).toBe('viable');
  });

  it('remains home resting when no viable feeding habitat exists', () => {
    const definition = cycleDefinition({
      feedingZones: [zone('closed', 10, 1, 4, false), zone('too-small', 12, 1, 1)],
    });
    const sample = sampleAnimalAquaticSchoolCycle(6, definition);

    expect(sample.phase).toBe('home-schooling');
    expect(sample.selectedFeedingZoneId).toBeUndefined();
    expect(sample.members.every(member => member.mode === 'rest' && member.zoneId === 'home')).toBeTrue();
  });

  it('requires safe home capacity for every member before direct reconstruction', () => {
    const definition = cycleDefinition({ memberCount: 3, homeZone: zone('home', 0, 1, 2) });

    expect(() => sampleAnimalAquaticSchoolCycle(0, definition)).toThrowError(/requires safe home capacity/i);
  });

  it('rejects invalid identity, durations, and replay limits before stepping', () => {
    expect(() => sampleAnimalAquaticSchoolCycle(Number.NaN, cycleDefinition())).toThrowError(/identity or time/i);
    expect(() => sampleAnimalAquaticSchoolCycle(0, cycleDefinition({ groupId: '' }))).toThrowError(/identity or time/i);
    expect(() => sampleAnimalAquaticSchoolCycle(0, cycleDefinition({ groupSeed: 0.5 }))).toThrowError(/identity or time/i);
    expect(() => sampleAnimalAquaticSchoolCycle(0, cycleDefinition({ memberCount: 9 }))).toThrowError(/identity or time/i);
    expect(() => sampleAnimalAquaticSchoolCycle(0, cycleDefinition({ schoolingDurationS: 0 }))).toThrowError(/work bounds/i);
    expect(() => sampleAnimalAquaticSchoolCycle(0, cycleDefinition({ fixedStepSeconds: Number.POSITIVE_INFINITY }))).toThrowError(/work bounds/i);
    expect(() => sampleAnimalAquaticSchoolCycle(0, cycleDefinition({ maximumReplaySteps: 0 }))).toThrowError(/work bounds/i);
    expect(() => sampleAnimalAquaticSchoolCycle(0, cycleDefinition({ fixedStepSeconds: 1, maximumReplaySteps: 11 }))).toThrowError(/work bounds/i);
  });
});

function cycleDefinition(overrides: Partial<AnimalAquaticSchoolCycleDefinition> = {}): AnimalAquaticSchoolCycleDefinition {
  return {
    groupId: 'coastal-herring', groupSeed: 42, memberCount: 2,
    homeZone: zone('home', 0, 1, 2), feedingZones: [zone('kelp', 12, 0.9, 4)],
    schoolingDurationS: 2, outboundDurationS: 3, feedingDurationS: 4, returnDurationS: 3,
    fixedStepSeconds: 1, maximumReplaySteps: 12, policy: policy(), ...overrides,
  };
}

function policy(): AnimalAquaticSchoolPolicyDefinition {
  return {
    water: flatWater(), maximumMembers: 8, maximumZones: 8, maximumZoneDistanceM: 50,
    minimumZoneSuitability01: 0.5, maximumSpeedMps: 4, maximumAccelerationMps2: 16,
    maximumSubstepDistanceM: 20, maximumSubsteps: 4, minimumSurfaceClearanceM: 1,
    minimumBottomClearanceM: 1, preferredSurfaceClearanceM: 5, maximumSurfaceClearanceM: 10,
    segmentSampleSpacingM: 2, separationRadiusM: 0, separationWeight: 0, cohesionWeight: 0,
    alignmentWeight: 0, targetWeight: 1, flowWeight: 0, depthWeight: 0, arrivalRadiusM: 0.1,
    slotSpacingM: 2, maximumAvoidanceAttempts: 3,
  };
}

function zone(id: string, x: number, suitability01: number, capacity: number, available = true): AnimalAquaticHabitatZone {
  return { id, position: { x, y: -5, z: 0 }, radiusM: 4, capacity, suitability01, available };
}

function comparable(sample: ReturnType<typeof sampleAnimalAquaticSchoolCycle>) {
  return { cycleTimeS: sample.cycleTimeS, cycleDurationS: sample.cycleDurationS, phase: sample.phase,
    selectedFeedingZoneId: sample.selectedFeedingZoneId, replaySteps: sample.replaySteps, members: sample.members };
}

function flatWater(): AnimalWaterVolume {
  return {
    sample: position => waterSample(position), isSegmentValid: () => true,
    moveAlongSurface: (position, velocity, seconds) => ({
      bodyId: bodyAt(position), position: { x: position.x + velocity.x * seconds, y: 0, z: position.z + velocity.z * seconds },
      normal: { x: 0, y: 1, z: 0 }, flow: { x: 0, y: 0, z: 0 },
    }),
    surfaceDistance: (from, to) => Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z),
  };
}

function waterSample(position: AnimalVector3): AnimalWaterVolumeSample {
  const containsWater = position.y < 0 && position.y > -20;
  const surfaceClearanceM = -position.y;
  const bottomClearanceM = position.y + 20;
  return {
    location: containsWater ? 'water' : position.y >= 0 ? 'above-surface' : 'below-bottom',
    containsWater, hasWaterBody: true, aboveSurface: position.y >= 0, belowBottom: position.y <= -20,
    dry: false, land: false, waterColumnDepthM: 20, surfaceClearanceM, bottomClearanceM,
    signedSurfaceDistanceM: position.y, signedBottomDistanceM: bottomClearanceM,
    surface: { bodyId: bodyAt(position), position: { x: position.x, y: 0, z: position.z },
      normal: { x: 0, y: 1, z: 0 }, flow: { x: 0, y: 0, z: 0 } },
    bottom: { position: { x: position.x, y: -20, z: position.z }, anchorRelativePosition: { x: position.x, y: -20, z: position.z },
      normal: { x: 0, y: 1, z: 0 }, surfaceUp: { x: 0, y: 1, z: 0 }, tangentU: { x: 1, y: 0, z: 0 }, tangentV: { x: 0, y: 0, z: 1 },
      elevationM: 0, slope01: 0, walkable: false },
  };
}

function bodyAt(position: AnimalVector3): string { return position.x === 13 ? 'other' : 'ocean'; }
