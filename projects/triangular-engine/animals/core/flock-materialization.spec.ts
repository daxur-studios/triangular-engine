import { materializeFlock } from './flock-materialization';

describe('materializeFlock', () => {
  const definition = {
    id: 'birds',
    seed: 7,
    origin: { x: 0, y: 5, z: 0 },
    count: 3,
    spacing: 4,
    speed: 2,
    cullDistance: 10,
    hysteresis: 3,
  };
  const observer = { position: { x: 0, y: 0, z: 0 }, radius: 1 };

  it('is deterministic and culls beyond the residency radius', () => {
    const first = materializeFlock(definition, observer);
    expect(materializeFlock(definition, observer)).toEqual(first);
    expect(
      materializeFlock(definition, {
        ...observer,
        position: { x: 20, y: 0, z: 0 },
      }),
    ).toEqual([]);
  });

  it('initializes velocity from the configured horizontal travel direction', () => {
    const flock = materializeFlock(
      { ...definition, travelDirection: { x: 3, y: 8, z: 4 } },
      observer,
    );
    expect(
      flock.every(
        ({ velocity }) =>
          velocity.x === 1.2 && velocity.y === 0 && velocity.z === 1.6,
      ),
    ).toBeTrue();
  });
});
