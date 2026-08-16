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
});
