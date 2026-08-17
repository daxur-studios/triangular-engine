import type { IPartArchetype } from './parts-archetype';
import { generatePartSkeleton, MAX_PART_SOLIDS } from './parts-skeleton';

describe('generatePartSkeleton', () => {
  const testArchetype: IPartArchetype = {
    schemaVersion: 1,
    id: 'test-part',
    solids: [
      {
        id: 'body-box',
        shape: 'box',
        positionM: [[-0.1, 0.1], [0.9, 1.1], [-0.1, 0.1]],
        dimensionsM: [[0.4, 0.6], [1.5, 2.0], [0.4, 0.6]],
        linkId: 0,
        materialHex: '#112233',
      },
      {
        id: 'nozzle-cone',
        shape: 'cone',
        positionM: [0, -0.5, 0],
        dimensionsM: [[0.3, 0.4], [0.1, 0.15], [0.5, 0.7]],
        linkId: 0,
      },
    ],
    sockets: [],
  };

  it('is strictly deterministic (same seed -> identical solids)', () => {
    const s1 = generatePartSkeleton(testArchetype, 42);
    const s2 = generatePartSkeleton(testArchetype, 42);

    expect(s1.length).toBe(s2.length);
    for (let i = 0; i < s1.length; i++) {
      expect(s1[i].id).toBe(s2[i].id);
      expect(s1[i].shape).toBe(s2[i].shape);
      expect(s1[i].positionM).toEqual(s2[i].positionM);
      expect(s1[i].dimensionsM).toEqual(s2[i].dimensionsM);
      expect(s1[i].orientation).toEqual(s2[i].orientation);
    }
  });

  it('produces varied dimensions for different seeds', () => {
    const s1 = generatePartSkeleton(testArchetype, 1);
    const s2 = generatePartSkeleton(testArchetype, 9999);

    expect(s1[0].dimensionsM).not.toEqual(s2[0].dimensionsM);
  });

  it('handles repeated solids correctly', () => {
    const repeatArchetype: IPartArchetype = {
      schemaVersion: 1,
      id: 'repeat-part',
      solids: [
        {
          id: 'wing-segment',
          shape: 'box',
          positionM: [0, 0, 0],
          dimensionsM: [0.5, 0.1, 0.4],
          repeatCount: 4,
          repeatOffsetM: [0.5, 0, 0],
          repeatScale01: 0.8,
        },
      ],
      sockets: [],
    };

    const skeleton = generatePartSkeleton(repeatArchetype, 100);
    expect(skeleton.length).toBe(4);
    expect(skeleton[0].id).toBe('wing-segment-0');
    expect(skeleton[3].id).toBe('wing-segment-3');
    expect(skeleton[3].positionM[0]).toBeCloseTo(1.5, 3);
    expect(skeleton[3].dimensionsM[0]).toBeLessThan(skeleton[0].dimensionsM[0]);
  });

  it('synthesizes solids with endpoints correctly', () => {
    const endpointArchetype: IPartArchetype = {
      schemaVersion: 1,
      id: 'endpoint-part',
      solids: [
        {
          id: 'strut',
          shape: 'cylinder',
          dimensionsM: [0.05, 1.0],
          endpoints: {
            startM: [0, 0, 0],
            endM: [0, 2, 0],
          },
        },
      ],
      sockets: [],
    };

    const skeleton = generatePartSkeleton(endpointArchetype, 123);
    expect(skeleton.length).toBe(1);
    expect(skeleton[0].positionM).toEqual([0, 1, 0]);
    expect(skeleton[0].dimensionsM[1]).toBeCloseTo(2.0, 3);
  });

  it('guards against runaway solid counts', () => {
    const runawayArchetype: IPartArchetype = {
      schemaVersion: 1,
      id: 'runaway-part',
      solids: [
        {
          id: 'runaway',
          shape: 'box',
          dimensionsM: [1, 1, 1],
          repeatCount: 32,
        },
        {
          id: 'runaway2',
          shape: 'box',
          dimensionsM: [1, 1, 1],
          repeatCount: 32,
        },
        {
          id: 'runaway3',
          shape: 'box',
          dimensionsM: [1, 1, 1],
          repeatCount: 32,
        },
        {
          id: 'runaway4',
          shape: 'box',
          dimensionsM: [1, 1, 1],
          repeatCount: 32,
        },
        {
          id: 'runaway5',
          shape: 'box',
          dimensionsM: [1, 1, 1],
          repeatCount: 32,
        },
      ],
      sockets: [],
    };

    expect(() => generatePartSkeleton(runawayArchetype, 1)).toThrowError(
      new RegExp(`exceeded maximum solid count \\(${MAX_PART_SOLIDS}\\)`),
    );
  });
});
