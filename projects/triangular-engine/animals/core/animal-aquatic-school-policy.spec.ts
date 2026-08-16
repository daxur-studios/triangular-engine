import {
  allocateAnimalAquaticZones,
  resolveAnimalAquaticZonePosition,
  stepAnimalAquaticSchool,
  type AnimalAquaticHabitatZone,
  type AnimalAquaticSchoolMember,
  type AnimalAquaticSchoolPolicyDefinition,
} from './animal-aquatic-school-policy';
import type { AnimalTime, AnimalVector3 } from './animal-types';
import type { AnimalWaterVolume, AnimalWaterVolumeSample } from './animal-water-volume';
import type { AnimalWorldSurfaceSample } from './animal-world-surface';

describe('animal aquatic-school policy', () => {
  it('allocates deterministic stable zone slots independently of member and zone input order', () => {
    const zones = [zone('good', 10, 0.9, 2), zone('far', 100, 1, 3), zone('poor', 11, 0.2, 2),
      zone('closed', 12, 1, 2, false), zone('other-body', 13, 1, 2)];
    const definition = schoolDefinition(water());
    const forward = allocateAnimalAquaticZones(['fish-c', 'fish-a', 'fish-b'], zones, zero, 1, definition);
    const reversed = allocateAnimalAquaticZones(['fish-b', 'fish-c', 'fish-a'], [...zones].reverse(), zero, 1, definition);

    expect(forward).toEqual([
      { memberId: 'fish-a', zoneId: 'good', slotIndex: 0, mode: 'assigned' },
      { memberId: 'fish-b', zoneId: 'good', slotIndex: 1, mode: 'assigned' },
      { memberId: 'fish-c', mode: 'unassigned' },
    ]);
    expect(reversed).toEqual(forward);
  });

  it('filters zones by suitability, range, water body, and safe clearance band', () => {
    const definition = schoolDefinition(water());
    const assignments = allocateAnimalAquaticZones(['fish'], [
      zone('poor', 5, 0.2), zone('far', 60, 1), zone('other-body', 13, 1),
      zone('too-deep', 14, 1, 1, true, 3, -8), zone('valid', 6, 0.8),
    ], zero, 1, definition);

    expect(assignments).toEqual([{ memberId: 'fish', zoneId: 'valid', slotIndex: 0, mode: 'assigned' }]);
  });

  it('uses distinct stable slot anchors and enforces zone capacity', () => {
    const definition = schoolDefinition(water());
    const reef = zone('reef', 10, 1, 3, true, 6);
    const first = resolveAnimalAquaticZonePosition(reef, 0, 1, definition);
    const second = resolveAnimalAquaticZonePosition(reef, 1, 1, definition);

    expect(first).toEqual({ x: 10, y: -3, z: 0 });
    expect(second).not.toEqual(first);
    expect(second.y).toBeGreaterThanOrEqual(-6);
    expect(second.y).toBeLessThanOrEqual(-1);
    expect(() => resolveAnimalAquaticZonePosition(reef, 3, 1, definition)).toThrowError(/outside zone capacity/);
  });

  it('travels through the shared water constraint without habitat assignments', () => {
    const result = stepAnimalAquaticSchool({
      members: [member('a', 0), member('b', -1)], intent: 'travel', target: { x: 10, y: -5, z: 0 },
      deltaSeconds: 1, universalTime: 0,
    }, schoolDefinition(water()));

    expect(result.assignments).toEqual([]);
    expect(result.members.every(value => value.mode === 'travel')).toBeTrue();
    expect(result.members.every(value => value.position.x > (value.id === 'a' ? 0 : -1))).toBeTrue();
    expect(result.constrained.every(value => !value.blocked)).toBeTrue();
  });

  it('stops forage and rest members at their assigned zone anchors', () => {
    const definition = schoolDefinition(water());
    const reef = zone('reef', 10, 1, 1);
    const anchored = { ...member('a', 10), position: { x: 10, y: -3, z: 0 }, velocity: { x: 1, y: 0, z: 0 } };
    const forage = stepAnimalAquaticSchool({ members: [anchored], intent: 'forage', target: anchored.position, zones: [reef], deltaSeconds: 1, universalTime: 0 }, definition);
    const rest = stepAnimalAquaticSchool({ members: [anchored], intent: 'rest', target: anchored.position, zones: [reef], deltaSeconds: 1, universalTime: 0 }, definition);

    expect(forage.members[0]).toEqual(jasmine.objectContaining({ mode: 'forage', zoneId: 'reef', velocity: zero }));
    expect(rest.members[0]).toEqual(jasmine.objectContaining({ mode: 'rest', zoneId: 'reef', velocity: zero }));
    expect(forage.constrained[0]).toEqual(jasmine.objectContaining({ blocked: false, substeps: 0 }));
  });

  it('keeps flow and depth steering within the water safety band', () => {
    const result = stepAnimalAquaticSchool({
      members: [{ ...member('a', 0), position: { x: 0, y: -5, z: 0 } }], intent: 'travel',
      target: { x: 10, y: -5, z: 0 }, deltaSeconds: 1, universalTime: 0,
    }, schoolDefinition(water(undefined, { x: 1, y: 0, z: 0 })));

    expect(result.constrained[0].blocked).toBeFalse();
    expect(result.members[0].position.x).toBeGreaterThan(0);
    expect(result.members[0].position.y).toBeGreaterThanOrEqual(-6);
    expect(result.members[0].position.y).toBeLessThanOrEqual(-1);
  });

  it('tries a local water detour, then returns a bounded block when every route is invalid', () => {
    const detour = stepAnimalAquaticSchool({
      members: [member('a', 0)], intent: 'travel', target: { x: 2, y: -5, z: 0 }, deltaSeconds: 1, universalTime: 0,
    }, schoolDefinition(water((from, to) => !(to.x > 0.1 && Math.abs(to.z) < 0.1))));
    const blocked = stepAnimalAquaticSchool({
      members: [member('a', 0)], intent: 'travel', target: { x: 2, y: -5, z: 0 }, deltaSeconds: 1, universalTime: 0,
    }, schoolDefinition(water(() => false)));

    expect(detour.constrained[0].blocked).toBeFalse();
    expect(detour.members[0].position.z).not.toBe(0);
    expect(blocked.constrained[0]).toEqual(jasmine.objectContaining({ blocked: true, blockReason: 'outside-water' }));
    expect(blocked.members[0]).toEqual(jasmine.objectContaining({ mode: 'blocked', position: member('a', 0).position }));
  });

  it('rejects duplicate IDs and bounded member or zone overflow', () => {
    const definition = schoolDefinition(water());
    expect(() => allocateAnimalAquaticZones(['same', 'same'], [], zero, 0, definition)).toThrowError(/unique/);
    expect(() => allocateAnimalAquaticZones(['one'], [zone('same', 1), zone('same', 2)], zero, 0, definition)).toThrowError(/unique/);
    expect(() => stepAnimalAquaticSchool({ members: [member('a', 0), member('b', 1), member('c', 2)], intent: 'travel', target: zero, deltaSeconds: 1, universalTime: 0 }, { ...definition, maximumMembers: 2 })).toThrowError(/bounded member limit/);
    expect(() => stepAnimalAquaticSchool({ members: [member('a', 0)], intent: 'forage', target: zero, zones: [zone('a', 1), zone('b', 2)], deltaSeconds: 1, universalTime: 0 }, { ...definition, maximumZones: 1 })).toThrowError(/bounded habitat-zone limit/);
  });
});

function schoolDefinition(volume: AnimalWaterVolume): AnimalAquaticSchoolPolicyDefinition {
  return {
    water: volume, maximumMembers: 8, maximumZones: 4, maximumZoneDistanceM: 50, minimumZoneSuitability01: 0.5,
    maximumSpeedMps: 2, maximumAccelerationMps2: 8, maximumSubstepDistanceM: 10, maximumSubsteps: 4,
    minimumSurfaceClearanceM: 1, minimumBottomClearanceM: 1, preferredSurfaceClearanceM: 3, maximumSurfaceClearanceM: 6,
    segmentSampleSpacingM: 1, separationRadiusM: 0, separationWeight: 0, cohesionWeight: 0, alignmentWeight: 0,
    targetWeight: 1, flowWeight: 1, depthWeight: 1, arrivalRadiusM: 0.1, slotSpacingM: 2, maximumAvoidanceAttempts: 3,
  };
}
function member(id: string, x: number): AnimalAquaticSchoolMember { return { id, position: { x, y: -5, z: 0 }, velocity: zero, mode: 'travel' }; }
function zone(id: string, x: number, suitability01 = 1, capacity = 1, available = true, radiusM = 4, y = -5): AnimalAquaticHabitatZone { return { id, position: { x, y, z: 0 }, radiusM, capacity, suitability01, available }; }
function water(segment: (from: AnimalVector3, to: AnimalVector3) => boolean = () => true, flow: AnimalVector3 = zero): AnimalWaterVolume {
  return {
    sample(position: AnimalVector3, _time: AnimalTime): AnimalWaterVolumeSample {
      const containsWater = position.y <= -1 && position.y >= -9;
      const bodyId = position.x === 13 ? 'lagoon' : 'sea';
      return {
        location: containsWater ? 'water' : position.y > -1 ? 'above-surface' : 'below-bottom', containsWater, hasWaterBody: true,
        aboveSurface: position.y > -1, belowBottom: position.y < -9, dry: false, land: false, waterColumnDepthM: 10,
        surfaceClearanceM: containsWater ? -position.y : 0, bottomClearanceM: containsWater ? position.y + 10 : 0,
        surface: { bodyId, position: { x: position.x, y: 0, z: position.z }, normal: { x: 0, y: 1, z: 0 }, flow },
        bottom: bottom(position),
      };
    },
    isSegmentValid: (from, to) => segment(from, to),
    moveAlongSurface(position, velocity, seconds, _time) { return { bodyId: position.x === 13 ? 'lagoon' : 'sea', position: { x: position.x + velocity.x * seconds, y: 0, z: position.z + velocity.z * seconds }, normal: { x: 0, y: 1, z: 0 }, flow }; },
    surfaceDistance: (from, to) => Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z),
  };
}
function bottom(position: AnimalVector3): AnimalWorldSurfaceSample { const point = { x: position.x, y: -10, z: position.z }; return { position: point, anchorRelativePosition: point, normal: { x: 0, y: 1, z: 0 }, surfaceUp: { x: 0, y: 1, z: 0 }, tangentU: { x: 1, y: 0, z: 0 }, tangentV: { x: 0, y: 0, z: 1 }, elevationM: 0, slope01: 0, walkable: true }; }
const zero: AnimalVector3 = { x: 0, y: 0, z: 0 };
