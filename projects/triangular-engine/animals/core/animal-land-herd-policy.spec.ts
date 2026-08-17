import {
  allocateAnimalHerdPatches,
  resolveAnimalHerdPatchPosition,
  resolveAnimalHerdTravelPosition,
  stepAnimalLandHerd,
  type AnimalGrazingPatch,
  type AnimalLandHerdMember,
  type AnimalLandHerdPolicyDefinition,
} from './animal-land-herd-policy';
import type { AnimalVector3 } from './animal-types';
import type { AnimalWorldSurface, AnimalWorldSurfaceSample } from './animal-world-surface';

describe('animal land-herd policy', () => {
  it('allocates deterministic stable slots independently of member and patch input order', () => {
    const surface = planeSurface();
    const patches: AnimalGrazingPatch[] = [
      patch('good', 10, 0.9, 2),
      patch('far', 100, 1, 4),
      patch('steep', 8, 1, 4),
      patch('poor', 6, 0.1, 4),
      patch('closed', 5, 1, 4, false),
    ];
    const assignments = allocateAnimalHerdPatches(['zebra-2', 'zebra-1', 'zebra-3'], patches, zero, surface, 2, 20, 0.5, 0.5);
    const reordered = allocateAnimalHerdPatches(['zebra-3', 'zebra-1', 'zebra-2'], [...patches].reverse(), zero, surface, 2, 20, 0.5, 0.5);

    expect(assignments).toEqual([
      { memberId: 'zebra-1', patchId: 'good', slotIndex: 0, mode: 'assigned' },
      { memberId: 'zebra-2', patchId: 'good', slotIndex: 1, mode: 'assigned' },
      { memberId: 'zebra-3', mode: 'unassigned' },
    ]);
    expect(reordered).toEqual(assignments);
  });

  it('filters unsuitable, out-of-range, unavailable and too-steep patches even when steep ground is walkable', () => {
    const surface = planeSurface((position) => position.x === 8 ? 0.8 : 0);
    const assignments = allocateAnimalHerdPatches(['one'], [
      patch('steep', 8, 1, 1), patch('far', 30, 1, 1), patch('poor', 5, 0.2, 1),
      patch('closed', 4, 1, 1, false), patch('usable', 6, 0.7, 1),
    ], zero, surface, 5, 20, 0.5, 0.5);

    expect(assignments).toEqual([{ memberId: 'one', patchId: 'usable', slotIndex: 0, mode: 'assigned' }]);
  });

  it('uses distinct stable slot positions and rejects an out-of-capacity slot', () => {
    const definition = herdDefinition();
    const meadow = patch('meadow', 10, 1, 3, true, 6);
    const first = resolveAnimalHerdPatchPosition(meadow, 0, definition);
    const second = resolveAnimalHerdPatchPosition(meadow, 1, definition);

    expect(first).toEqual({ x: 10, y: 0, z: 0 });
    expect(second).not.toEqual(first);
    expect(() => resolveAnimalHerdPatchPosition(meadow, 3, definition)).toThrowError(/outside patch capacity/);
  });

  it('moves travelling members over the surface without applying grazing assignments', () => {
    const result = stepAnimalLandHerd({
      members: [member('a', 0), member('b', -1)], intent: 'travel', target: { x: 10, y: 0, z: 0 },
      deltaSeconds: 1, universalTime: 0,
    }, herdDefinition());

    expect(result.assignments).toEqual([]);
    expect(result.members.every(value => value.mode === 'travel')).toBeTrue();
    expect(result.members.every(value => value.position.y === 0 && value.position.x > (value.id === 'a' ? 0 : -1))).toBeTrue();
    expect(result.constrained.every(value => !value.blocked)).toBeTrue();
  });

  it('gives travelling herd members stable positions in a loose line instead of one shared target', () => {
    const definition = { ...herdDefinition(), travelLineSpacingM: 2, travelLineLateralSpacingM: 0.4 };
    const ids = ['zebra-c', 'zebra-a', 'zebra-b'];
    const targets = ids.map(id => resolveAnimalHerdTravelPosition(
      id, ids, zero, { x: 10, y: 0, z: 0 }, zero, definition,
    ));
    const reordered = [...ids].reverse().map(id => resolveAnimalHerdTravelPosition(
      id, [...ids].reverse(), zero, { x: 10, y: 0, z: 0 }, zero, definition,
    ));

    expect(targets).toEqual([
      { x: 6, y: 0, z: -0.4 }, { x: 10, y: 0, z: -0.4 }, { x: 8, y: 0, z: 0.4 },
    ]);
    expect(reordered).toEqual([
      { x: 8, y: 0, z: 0.4 }, { x: 10, y: 0, z: -0.4 }, { x: 6, y: 0, z: -0.4 },
    ]);
  });

  it('stops grazing and resting members at their assigned patch anchor', () => {
    const definition = herdDefinition();
    const meadow = patch('meadow', 10, 1, 1);
    const atAnchor = { ...member('a', 10), velocity: { x: 2, y: 0, z: 0 } };
    const graze = stepAnimalLandHerd({ members: [atAnchor], intent: 'graze', target: { x: 10, y: 0, z: 0 }, patches: [meadow], deltaSeconds: 1, universalTime: 0 }, definition);
    const rest = stepAnimalLandHerd({ members: [atAnchor], intent: 'rest', target: { x: 10, y: 0, z: 0 }, patches: [meadow], deltaSeconds: 1, universalTime: 0 }, definition);

    expect(graze.members[0]).toEqual(jasmine.objectContaining({ mode: 'graze', patchId: 'meadow', velocity: zero }));
    expect(rest.members[0]).toEqual(jasmine.objectContaining({ mode: 'rest', patchId: 'meadow', velocity: zero }));
    expect(graze.constrained[0]).toEqual(jasmine.objectContaining({ blocked: false, substeps: 0 }));
  });

  it('tries a local detour, then reports a bounded block when every local option is blocked', () => {
    const detourDefinition = herdDefinition(planeSurface(
      () => 0,
      (position) => !(position.x > 0.1 && Math.abs(position.z) < 0.1),
    ));
    const detour = stepAnimalLandHerd({
      members: [member('a', 0)], intent: 'travel', target: { x: 2, y: 0, z: 0 }, deltaSeconds: 1, universalTime: 0,
    }, { ...detourDefinition, maximumAvoidanceAttempts: 2 });
    const blocked = stepAnimalLandHerd({
      members: [member('a', 0)], intent: 'travel', target: { x: 2, y: 0, z: 0 }, deltaSeconds: 1, universalTime: 0,
    }, { ...herdDefinition(planeSurface(() => 0, (position) => !(position.x > 0.1))), maximumAvoidanceAttempts: 2 });

    expect(detour.constrained[0].blocked).toBeFalse();
    expect(detour.members[0].position.z).not.toBe(0);
    expect(blocked.constrained[0]).toEqual(jasmine.objectContaining({ blocked: true, blockReason: 'blocked-surface' }));
    expect(blocked.members[0]).toEqual(jasmine.objectContaining({ mode: 'blocked', position: zero }));
  });

  it('repels a travelling member from terrain obstacles supplied by an adapter', () => {
    const result = stepAnimalLandHerd({
      members: [member('a', 0)], intent: 'travel', target: { x: 6, y: 0, z: 0 },
      deltaSeconds: 1, universalTime: 0,
    }, { ...herdDefinition(), separationRadiusM: 2, separationWeight: 4,
      obstacles: [{ id: 'tree-1', position: { x: 1, y: 0, z: 0 }, radiusM: 2 }] });
    expect(result.members[0].position.x).toBeLessThan(1);
  });

  it('rejects duplicate IDs and bounded member or patch input overflow', () => {
    expect(() => allocateAnimalHerdPatches(['same', 'same'], [], zero, planeSurface(), 1)).toThrowError(/unique/);
    expect(() => allocateAnimalHerdPatches(['one'], [patch('same', 1), patch('same', 2)], zero, planeSurface(), 2)).toThrowError(/unique/);
    expect(() => stepAnimalLandHerd({ members: [member('a', 0), member('b', 1), member('c', 2)], intent: 'travel', target: zero, deltaSeconds: 1, universalTime: 0 }, { ...herdDefinition(), maximumMembers: 2 })).toThrowError(/bounded member limit/);
    expect(() => stepAnimalLandHerd({ members: [member('a', 0)], intent: 'graze', target: zero, patches: [patch('a', 1), patch('b', 2)], deltaSeconds: 1, universalTime: 0 }, { ...herdDefinition(), maximumPatches: 1 })).toThrowError(/bounded patch limit/);
  });
});

function herdDefinition(surface = planeSurface()): AnimalLandHerdPolicyDefinition {
  return {
    surface, maximumMembers: 8, maximumPatches: 8, maximumSpeedMps: 2, maximumAccelerationMps2: 8,
    maximumSubstepDistanceM: 10, maximumSubsteps: 4, maximumSlope01: 0.5, maximumPatchDistanceM: 50,
    minimumPatchSuitability01: 0.5, separationRadiusM: 0, separationWeight: 0, cohesionWeight: 0,
    alignmentWeight: 0, targetWeight: 1, arrivalRadiusM: 0.1, slotSpacingM: 2, maximumAvoidanceAttempts: 3,
  };
}
function member(id: string, x: number): AnimalLandHerdMember { return { id, position: { x, y: 0, z: 0 }, velocity: zero, mode: 'travel' }; }
function patch(id: string, x: number, suitability01 = 1, capacity = 1, available = true, radiusM = 4): AnimalGrazingPatch {
  return { id, position: { x, y: 0, z: 0 }, radiusM, capacity, suitability01, available };
}
function planeSurface(
  slope01: (position: AnimalVector3) => number = () => 0,
  walkable: (position: AnimalVector3) => boolean = () => true,
): AnimalWorldSurface {
  return {
    kind: 'plane', sample: (position) => sample(position, slope01(position), walkable(position)), projectToSurface: (position) => ({ x: position.x, y: 0, z: position.z }),
    moveAlongSurface: (position, velocity, seconds) => ({ x: position.x + velocity.x * seconds, y: 0, z: position.z + velocity.z * seconds }),
    surfaceDistance: (from, to) => Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z),
  };
}
function sample(position: AnimalVector3, slope01: number, walkable: boolean): AnimalWorldSurfaceSample {
  const onSurface = { x: position.x, y: 0, z: position.z };
  return { position: onSurface, anchorRelativePosition: onSurface, normal: { x: 0, y: 1, z: 0 }, surfaceUp: { x: 0, y: 1, z: 0 }, tangentU: { x: 1, y: 0, z: 0 }, tangentV: { x: 0, y: 0, z: 1 }, elevationM: 0, slope01, walkable };
}
const zero: AnimalVector3 = { x: 0, y: 0, z: 0 };
