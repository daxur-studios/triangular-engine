import {
  AnimalGroupTimeline,
  sampleAnimalGroupTimeline,
} from './animal-group-timeline';
import { materializeAnimalGroup } from './animal-group-materialization';

describe('materializeAnimalGroup', () => {
  const timeline: AnimalGroupTimeline = {
    key: {
      worldId: 'world',
      planetId: 'planet',
      cellId: 'cell-7',
      speciesId: 'birds',
      groupId: 'flock-2',
      seed: 41,
    },
    destinations: [
      {
        id: 'feeding-area',
        position: { x: 0, y: 4, z: 0 },
        activity: 'feed',
        dwellDuration: 10,
      },
      {
        id: 'tree-perch',
        position: { x: 30, y: 10, z: 0 },
        activity: 'rest',
        dwellDuration: 20,
      },
    ],
    travelSpeed: Math.sqrt(30 * 30 + 6 * 6) / 10,
    memberCount: 3,
    epoch: 100,
  };
  const definition = {
    spacing: 4,
    speed: 2,
    cullDistance: 10,
    hysteresis: 3,
    travelDirection: { x: 1, y: 0, z: 0 },
  };

  it('recreates stable member identities and offsets at the same universal time', () => {
    const snapshot = sampleAnimalGroupTimeline(timeline, 115);
    const observer = { position: snapshot.position, radius: 1 };
    const first = materializeAnimalGroup(snapshot, observer, definition);
    const laterSnapshot = sampleAnimalGroupTimeline(timeline, 116);
    const later = materializeAnimalGroup(
      laterSnapshot,
      { position: laterSnapshot.position, radius: 1 },
      definition,
    );

    expect(materializeAnimalGroup(snapshot, observer, definition)).toEqual(
      first,
    );
    expect(first.map((member) => member.id)).toEqual([
      `${snapshot.id}:0`,
      `${snapshot.id}:1`,
      `${snapshot.id}:2`,
    ]);
    const offsets = first.map((member) => ({
      x: member.position.x - snapshot.position.x,
      y: member.position.y - snapshot.position.y,
      z: member.position.z - snapshot.position.z,
    }));
    const laterOffsets = later.map((member) => ({
      x: member.position.x - laterSnapshot.position.x,
      y: member.position.y - laterSnapshot.position.y,
      z: member.position.z - laterSnapshot.position.z,
    }));
    laterOffsets.forEach((offset, index) => {
      expect(offset.x).toBeCloseTo(offsets[index].x, 12);
      expect(offset.y).toBeCloseTo(offsets[index].y, 12);
      expect(offset.z).toBeCloseTo(offsets[index].z, 12);
    });
    expect(
      materializeAnimalGroup(snapshot, observer, definition).map((member) => ({
        x: member.position.x - snapshot.position.x,
        y: member.position.y - snapshot.position.y,
        z: member.position.z - snapshot.position.z,
      })),
    ).toEqual(offsets);
  });

  it('dematerializes out of range and recreates the same flock on return', () => {
    const snapshot = sampleAnimalGroupTimeline(timeline, 115);
    const near = { position: snapshot.position, radius: 1 };
    const first = materializeAnimalGroup(snapshot, near, definition);

    expect(
      materializeAnimalGroup(
        snapshot,
        {
          position: { x: 100, y: 100, z: 100 },
          radius: 0,
        },
        definition,
      ),
    ).toEqual([]);
    expect(
      materializeAnimalGroup(
        sampleAnimalGroupTimeline(timeline, 115),
        near,
        definition,
      ),
    ).toEqual(first);
  });

  it('uses local travel direction while keeping dwell snapshots stationary', () => {
    const travelling = sampleAnimalGroupTimeline(timeline, 115);
    const dwelling = sampleAnimalGroupTimeline(timeline, 105);

    expect(
      materializeAnimalGroup(
        travelling,
        { position: travelling.position, radius: 0 },
        definition,
      ).every((member) => member.velocity.x === 2 && member.velocity.z === 0),
    ).toBeTrue();
    expect(
      materializeAnimalGroup(
        dwelling,
        { position: dwelling.position, radius: 0 },
        definition,
      ).every((member) => member.velocity.x === 0 && member.velocity.z === 0),
    ).toBeTrue();
  });

  it('directly reconstructs a moving 3D flight formation from the group snapshot', () => {
    const flightTimeline = { ...timeline, travelArcHeight: 8 };
    const snapshot = sampleAnimalGroupTimeline(flightTimeline, 115);
    const flightDefinition = { ...definition, formation: 'flight' as const };
    const observer = { position: snapshot.position, radius: 1 };
    const first = materializeAnimalGroup(snapshot, observer, flightDefinition);
    const later = materializeAnimalGroup(
      sampleAnimalGroupTimeline(flightTimeline, 115.25),
      { position: sampleAnimalGroupTimeline(flightTimeline, 115.25).position, radius: 1 },
      flightDefinition,
    );

    expect(materializeAnimalGroup(snapshot, observer, flightDefinition)).toEqual(first);
    expect(first.some((member) => member.position.y !== snapshot.position.y)).toBeTrue();
    expect(first.every((member) => member.velocity.y === snapshot.velocity.y)).toBeTrue();
    expect(later.map((member) => member.id)).toEqual(first.map((member) => member.id));
  });

  it('never collapses members onto the group centre when the group is resting', () => {
    const flightTimeline = { ...timeline, travelArcHeight: 8 };
    const flightDefinition = { ...definition, formation: 'flight' as const };
    const resting = sampleAnimalGroupTimeline(flightTimeline, 125); // dwelling at tree-perch
    const observer = { position: resting.position, radius: 1 };

    const members = materializeAnimalGroup(resting, observer, flightDefinition);

    expect(resting.activity).toBe('rest');
    expect(resting.velocity).toEqual({ x: 0, y: 0, z: 0 });
    for (const member of members) {
      const offset = Math.hypot(
        member.position.x - resting.position.x,
        member.position.y - resting.position.y,
        member.position.z - resting.position.z,
      );
      expect(offset).toBeGreaterThan(0.01);
    }
    // Members must also be spread apart from each other, not stacked.
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const apart = Math.hypot(
          members[i].position.x - members[j].position.x,
          members[i].position.y - members[j].position.y,
          members[i].position.z - members[j].position.z,
        );
        expect(apart).toBeGreaterThan(0.01);
      }
    }
  });

  it('keeps materialized positions continuous across an activity transition', () => {
    const flightTimeline = { ...timeline, travelArcHeight: 8 };
    const flightDefinition = { ...definition, formation: 'flight' as const };
    // cycleTime 20 (epoch 100 -> time 120) is the exact arrival instant at
    // tree-perch, where activity flips from 'travel' to 'rest'.
    const before = sampleAnimalGroupTimeline(flightTimeline, 120 - 1e-6);
    const after = sampleAnimalGroupTimeline(flightTimeline, 120 + 1e-6);
    expect(before.activity).toBe('travel');
    expect(after.activity).toBe('rest');

    const beforeMembers = materializeAnimalGroup(
      before,
      { position: before.position, radius: 1 },
      flightDefinition,
    );
    const afterMembers = materializeAnimalGroup(
      after,
      { position: after.position, radius: 1 },
      flightDefinition,
    );

    beforeMembers.forEach((member, index) => {
      const jump = Math.hypot(
        member.position.x - afterMembers[index].position.x,
        member.position.y - afterMembers[index].position.y,
        member.position.z - afterMembers[index].position.z,
      );
      expect(jump).toBeLessThan(0.01);
    });
  });

  it('reconstructs distinct compact-rest and broad-feed group states', () => {
    const flightTimeline = { ...timeline, travelArcHeight: 8 };
    const flightDefinition = { ...definition, formation: 'flight' as const };
    const feeding = sampleAnimalGroupTimeline(flightTimeline, 105);
    const resting = sampleAnimalGroupTimeline(flightTimeline, 130);
    const feedMembers = materializeAnimalGroup(
      feeding,
      { position: feeding.position, radius: 1 },
      flightDefinition,
    );
    const restMembers = materializeAnimalGroup(
      resting,
      { position: resting.position, radius: 1 },
      flightDefinition,
    );
    const horizontalSpread = (members: typeof feedMembers, centre: typeof feeding.position) =>
      members.reduce(
        (total, member) => total + Math.hypot(
          member.position.x - centre.x,
          member.position.z - centre.z,
        ),
        0,
      ) / members.length;

    expect(feeding.activity).toBe('feed');
    expect(resting.activity).toBe('rest');
    expect(horizontalSpread(feedMembers, feeding.position)).toBeGreaterThan(
      horizontalSpread(restMembers, resting.position),
    );
    expect(materializeAnimalGroup(
      feeding,
      { position: feeding.position, radius: 1 },
      flightDefinition,
    )).toEqual(feedMembers);
  });
});
