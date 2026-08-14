import {
  deriveProceduralSocketId,
  transformProceduralSocket,
  type IProceduralInstanceTransform,
  type IProceduralSocket,
} from './procedural-socket';

describe('deriveProceduralSocketId', () => {
  const base = {
    archetypeId: 'oak-01',
    seed: 42,
    schemaVersion: 1,
    kind: 'perch' as const,
    ordinal: 0,
  };

  it('is deterministic for identical inputs', () => {
    expect(deriveProceduralSocketId(base)).toBe(deriveProceduralSocketId({ ...base }));
  });

  it('differs when the ordinal differs', () => {
    expect(deriveProceduralSocketId(base)).not.toBe(
      deriveProceduralSocketId({ ...base, ordinal: 1 }),
    );
  });

  it('differs when the kind differs', () => {
    expect(deriveProceduralSocketId(base)).not.toBe(
      deriveProceduralSocketId({ ...base, kind: 'fruit-slot' }),
    );
  });

  it('differs when the seed differs', () => {
    expect(deriveProceduralSocketId(base)).not.toBe(
      deriveProceduralSocketId({ ...base, seed: 43 }),
    );
  });

  it('differs when the archetypeId differs', () => {
    expect(deriveProceduralSocketId(base)).not.toBe(
      deriveProceduralSocketId({ ...base, archetypeId: 'oak-02' }),
    );
  });

  it('is prefixed with the socket kind for readability', () => {
    expect(deriveProceduralSocketId(base)).toMatch(/^perch-[0-9a-f]+$/);
  });

  it('rejects an empty archetypeId', () => {
    expect(() => deriveProceduralSocketId({ ...base, archetypeId: '' })).toThrowError(
      RangeError,
    );
  });

  it('rejects a negative or non-integer ordinal', () => {
    expect(() => deriveProceduralSocketId({ ...base, ordinal: -1 })).toThrowError(RangeError);
    expect(() => deriveProceduralSocketId({ ...base, ordinal: 1.5 })).toThrowError(RangeError);
  });
});

describe('transformProceduralSocket', () => {
  const IDENTITY: IProceduralInstanceTransform = {
    positionM: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
    scale: 1,
  };

  function makeSocket(overrides: Partial<IProceduralSocket> = {}): IProceduralSocket {
    return {
      id: 'perch-abc123',
      kind: 'perch',
      positionM: [1, 2, 3],
      orientation: [0, 0, 0, 1],
      clearanceRadiusM: 0.5,
      ...overrides,
    };
  }

  it('leaves a socket unchanged under the identity transform', () => {
    const socket = makeSocket();
    expect(transformProceduralSocket(socket, IDENTITY)).toEqual(socket);
  });

  it('translates the socket position by the transform position', () => {
    const socket = makeSocket({ positionM: [1, 2, 3] });
    const transform: IProceduralInstanceTransform = {
      positionM: [10, 0, -5],
      quaternion: [0, 0, 0, 1],
      scale: 1,
    };
    expect(transformProceduralSocket(socket, transform).positionM).toEqual([11, 2, -2]);
  });

  it('scales position and clearance radius uniformly', () => {
    const socket = makeSocket({ positionM: [1, 2, 3], clearanceRadiusM: 0.5 });
    const transform: IProceduralInstanceTransform = {
      positionM: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: 2,
    };
    const world = transformProceduralSocket(socket, transform);
    expect(world.positionM).toEqual([2, 4, 6]);
    expect(world.clearanceRadiusM).toBe(1);
  });

  it('rotates a local socket position by a 90-degree yaw', () => {
    // 90 degree rotation about +Y: [1, 0, 0] -> [0, 0, -1] (three.js convention).
    const socket = makeSocket({ positionM: [1, 0, 0] });
    const halfAngle = Math.PI / 4;
    const transform: IProceduralInstanceTransform = {
      positionM: [0, 0, 0],
      quaternion: [0, Math.sin(halfAngle), 0, Math.cos(halfAngle)],
      scale: 1,
    };
    const world = transformProceduralSocket(socket, transform);
    expect(world.positionM[0]).toBeCloseTo(0);
    expect(world.positionM[1]).toBeCloseTo(0);
    expect(world.positionM[2]).toBeCloseTo(-1);
  });

  it('composes the instance orientation with the socket orientation rather than discarding it', () => {
    const halfAngle = Math.PI / 4;
    const socket = makeSocket({
      positionM: [0, 0, 0],
      orientation: [0, Math.sin(halfAngle), 0, Math.cos(halfAngle)],
    });
    const transform: IProceduralInstanceTransform = {
      positionM: [0, 0, 0],
      quaternion: [0, Math.sin(halfAngle), 0, Math.cos(halfAngle)],
      scale: 1,
    };
    const world = transformProceduralSocket(socket, transform);
    // Two composed 90-degree yaws = 180 degrees: [0, sin(90deg), 0, cos(90deg)] = [0, 1, 0, 0].
    expect(world.orientation[0]).toBeCloseTo(0);
    expect(world.orientation[1]).toBeCloseTo(1);
    expect(world.orientation[2]).toBeCloseTo(0);
    expect(world.orientation[3]).toBeCloseTo(0);
  });

  it('preserves id and kind', () => {
    const socket = makeSocket({ id: 'fruit-slot-deadbeef', kind: 'fruit-slot' });
    const transform: IProceduralInstanceTransform = {
      positionM: [5, 5, 5],
      quaternion: [0, 0, 0, 1],
      scale: 1.5,
    };
    const world = transformProceduralSocket(socket, transform);
    expect(world.id).toBe('fruit-slot-deadbeef');
    expect(world.kind).toBe('fruit-slot');
  });
});
