import {
  allocateAnimalRoosts,
  stepAnimalAirFlock,
  type AnimalAirFlockMember,
  type AnimalAirFlockPolicyDefinition,
  type AnimalRoostSite,
} from './animal-air-flock-policy';
import type { AnimalVector3 } from './animal-types';
import type { AnimalWorldSurface, AnimalWorldSurfaceSample } from './animal-world-surface';

describe('animal air-flock policy', () => {
  const surface = flatSurface();

  it('allocates finite roost capacity deterministically, independent of member and site input order', () => {
    const members = ['bird-c', 'bird-a', 'bird-b'];
    const sites: AnimalRoostSite[] = [
      { id: 'tree-b', position: { x: 20, y: 3, z: 0 }, capacity: 2 },
      { id: 'tree-a', position: { x: 10, y: 3, z: 0 }, capacity: 1 },
      { id: 'closed', position: { x: 1, y: 3, z: 0 }, capacity: 9, available: false },
    ];

    const forward = allocateAnimalRoosts(members, sites, { x: 0, y: 0, z: 0 }, surface, 2);
    const reversed = allocateAnimalRoosts([...members].reverse(), [...sites].reverse(), { x: 0, y: 0, z: 0 }, surface, 2);

    expect(forward).toEqual([
      { memberId: 'bird-a', perchId: 'tree-a', slotIndex: 0, mode: 'assigned' },
      { memberId: 'bird-b', perchId: 'tree-b', slotIndex: 0, mode: 'assigned' },
      { memberId: 'bird-c', perchId: 'tree-b', slotIndex: 1, mode: 'assigned' },
    ]);
    expect(reversed).toEqual(forward);
  });

  it('puts stable overflow members into holding when bounded roost capacity is exhausted', () => {
    const assignments = allocateAnimalRoosts(
      ['bird-3', 'bird-1', 'bird-2'],
      [{ id: 'only-perch', position: { x: 2, y: 3, z: 0 }, capacity: 1 }],
      { x: 0, y: 0, z: 0 },
      surface,
      1,
    );

    expect(assignments).toEqual([
      { memberId: 'bird-1', perchId: 'only-perch', slotIndex: 0, mode: 'assigned' },
      { memberId: 'bird-2', mode: 'holding' },
      { memberId: 'bird-3', mode: 'holding' },
    ]);
  });

  it('gives capacity slots stable indices and distinct tangent-frame perch positions', () => {
    const result = stepAnimalAirFlock({
      members: [member('bird-b', { x: 0, y: 3, z: 0 }), member('bird-a', { x: 0, y: 3, z: 0 })],
      intent: 'roost', target: { x: 0, y: 3, z: 0 },
      roostSites: [{ id: 'wide-branch', position: { x: 0, y: 3, z: 0 }, capacity: 2 }],
      deltaSeconds: 1, universalTime: 10,
    }, { ...definition(), arrivalRadiusM: 3, roostSlotSpacingM: 2 });
    const byId = new Map(result.members.map(item => [item.id, item]));
    const birdA = byId.get('bird-a')!;
    const birdB = byId.get('bird-b')!;

    expect(result.assignments).toEqual([
      { memberId: 'bird-a', perchId: 'wide-branch', slotIndex: 0, mode: 'assigned' },
      { memberId: 'bird-b', perchId: 'wide-branch', slotIndex: 1, mode: 'assigned' },
    ]);
    expect(birdA.mode).toBe('perched');
    expect(birdB.mode).toBe('perched');
    expect(distance(birdA.position, birdB.position)).toBeCloseTo(2, 8);
    expect(result.constrained.every(item => item.substeps === 0 && !item.blocked)).toBeTrue();
  });

  it('uses the same deterministic nearest-site selection when stepping, even if roost input order differs', () => {
    const input = {
      members: [member('bird-a', { x: 1, y: 3, z: 0 })],
      intent: 'roost' as const,
      target: { x: 1, y: 3, z: 0 },
      // The nearest site is deliberately after the distant site. A policy must not
      // allocate one site then look up a different bounded prefix of this array.
      roostSites: [
        { id: 'distant', position: { x: 100, y: 3, z: 0 }, capacity: 1 },
        { id: 'near', position: { x: 1, y: 3, z: 0 }, capacity: 1 },
      ],
      deltaSeconds: 1,
      universalTime: 10,
    };

    const forward = stepAnimalAirFlock(input, { ...definition(), maximumRoostSites: 2 });
    const reversed = stepAnimalAirFlock({ ...input, roostSites: [...input.roostSites].reverse() }, {
      ...definition(), maximumRoostSites: 2,
    });

    expect(forward.assignments).toEqual([{ memberId: 'bird-a', perchId: 'near', slotIndex: 0, mode: 'assigned' }]);
    expect(forward.members[0]).toEqual({
      id: 'bird-a', position: { x: 1, y: 3, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, mode: 'perched', perchId: 'near',
    });
    expect(reversed).toEqual(forward);
  });

  it('keeps an arrived roost member stationary, while an explicit fly intent departs through the shared movement kernel', () => {
    const perched = member('bird-a', { x: 0, y: 3, z: 0 }, 'perched');
    const roost = stepAnimalAirFlock({
      members: [perched], intent: 'roost', target: { x: 0, y: 3, z: 0 },
      roostSites: [{ id: 'tree', position: { x: 0, y: 3, z: 0 }, capacity: 1 }], deltaSeconds: 1, universalTime: 11,
    }, definition());
    const departure = stepAnimalAirFlock({
      members: roost.members, intent: 'fly', target: { x: 20, y: 3, z: 0 }, deltaSeconds: 1, universalTime: 12,
    }, definition());

    expect(roost.members[0].mode).toBe('perched');
    expect(roost.constrained[0]).toEqual({
      position: { x: 0, y: 3, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, blocked: false, blockReason: 'none', substeps: 0,
    });
    expect(departure.members[0].mode).toBe('flight');
    expect(departure.members[0].position.x).toBeGreaterThan(0);
    expect(departure.constrained[0].blocked).toBeFalse();
  });

  it('passes its declared altitude band to the shape-neutral movement constraint', () => {
    const result = stepAnimalAirFlock({
      members: [member('too-low', { x: 0, y: 1, z: 0 })], intent: 'fly', target: { x: 20, y: 3, z: 0 },
      deltaSeconds: 1, universalTime: 12,
    }, { ...definition(), minimumAltitudeM: 2, preferredAltitudeM: 3 });

    expect(result.constrained[0]).toEqual({
      position: { x: 0, y: 1, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
      blocked: true, blockReason: 'invalid-start', substeps: 0,
    });
  });

  it('rejects duplicate member IDs for both fly and roost intents, and enforces its member bound', () => {
    const duplicates = [member('same', { x: 0, y: 3, z: 0 }), member('same', { x: 2, y: 3, z: 0 })];
    const base = { members: duplicates, target: { x: 10, y: 3, z: 0 }, deltaSeconds: 1, universalTime: 0 };

    expect(() => stepAnimalAirFlock({ ...base, intent: 'fly' }, definition())).toThrowError(/unique/);
    expect(() => stepAnimalAirFlock({ ...base, intent: 'roost', roostSites: [] }, definition())).toThrowError(/unique/);
    expect(() => stepAnimalAirFlock({
      members: [member('a', { x: 0, y: 3, z: 0 }), member('b', { x: 1, y: 3, z: 0 })],
      intent: 'fly', target: { x: 10, y: 3, z: 0 }, deltaSeconds: 1, universalTime: 0,
    }, { ...definition(), maximumMembers: 1 })).toThrowError(/bounded member limit/);
    expect(() => stepAnimalAirFlock({
      members: [member('a', { x: 0, y: 3, z: 0 })], intent: 'roost', target: { x: 0, y: 3, z: 0 },
      roostSites: [
        { id: 'one', position: { x: 0, y: 3, z: 0 }, capacity: 1 },
        { id: 'two', position: { x: 1, y: 3, z: 0 }, capacity: 1 },
      ], deltaSeconds: 1, universalTime: 0,
    }, { ...definition(), maximumRoostSites: 1 })).toThrowError(/bounded roost-site limit/);
  });
});

function definition(): AnimalAirFlockPolicyDefinition {
  return {
    surface: flatSurface(), maximumMembers: 8, maximumRoostSites: 4,
    maximumSpeedMps: 8, maximumAccelerationMps2: 8, maximumSubstepDistanceM: 20, maximumSubsteps: 4,
    minimumAltitudeM: 1, maximumAltitudeM: 10, preferredAltitudeM: 3,
    separationRadiusM: 2, separationWeight: 1, cohesionWeight: 1, alignmentWeight: 1, targetWeight: 4,
    arrivalRadiusM: 0.5, holdingRadiusM: 5, holdingSpeedMps: 1, roostSlotSpacingM: 2,
  };
}

function member(id: string, position: AnimalVector3, mode: AnimalAirFlockMember['mode'] = 'flight'): AnimalAirFlockMember {
  return { id, position, velocity: { x: 0, y: 0, z: 0 }, mode };
}

function flatSurface(): AnimalWorldSurface {
  return {
    kind: 'plane',
    sample: (position) => sample(position),
    projectToSurface: (position) => ({ x: position.x, y: 0, z: position.z }),
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

function distance(a: AnimalVector3, b: AnimalVector3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
