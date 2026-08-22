import {
  type IStructureArchetype,
  validateStructureArchetype,
} from './structures-archetype';
import { DEMO_CHOPSTICK_TOWER_ARCHETYPE, DEMO_LAUNCHPAD_ARCHETYPE, DEMO_RUNWAY_ARCHETYPE } from './structures-catalog';

describe('validateStructureArchetype', () => {
  it('accepts valid demo archetypes', () => {
    expect(() => validateStructureArchetype(DEMO_RUNWAY_ARCHETYPE)).not.toThrow();
    expect(() => validateStructureArchetype(DEMO_LAUNCHPAD_ARCHETYPE)).not.toThrow();
    expect(() => validateStructureArchetype(DEMO_CHOPSTICK_TOWER_ARCHETYPE)).not.toThrow();
  });

  it('rejects invalid schemaVersion', () => {
    const invalid = { ...DEMO_RUNWAY_ARCHETYPE, schemaVersion: 0 as 1 };
    expect(() => validateStructureArchetype(invalid)).toThrowError(
      /schemaVersion must be a positive integer/,
    );
  });

  it('rejects empty id', () => {
    const invalid = { ...DEMO_RUNWAY_ARCHETYPE, id: '' };
    expect(() => validateStructureArchetype(invalid)).toThrowError(/id must be a non-empty string/);
  });

  it('rejects invalid footprint kind or dimensions', () => {
    const invalidKind = {
      ...DEMO_RUNWAY_ARCHETYPE,
      footprint: { kind: 'triangle' as any, dimensionsM: [10, 20] },
    };
    expect(() => validateStructureArchetype(invalidKind)).toThrowError(/must declare a valid footprint/);

    const invalidDims = {
      ...DEMO_RUNWAY_ARCHETYPE,
      footprint: { kind: 'rect' as const, dimensionsM: [10] }, // rect expects 2 dims
    };
    expect(() => validateStructureArchetype(invalidDims)).toThrowError(/expects 2 dimensions, got 1/);
  });

  it('rejects empty solids array', () => {
    const invalid = { ...DEMO_RUNWAY_ARCHETYPE, solids: [] };
    expect(() => validateStructureArchetype(invalid)).toThrowError(
      /must declare at least one solid/,
    );
  });

  it('rejects duplicate solid ids', () => {
    const invalid: IStructureArchetype = {
      ...DEMO_RUNWAY_ARCHETYPE,
      solids: [
        {
          id: 'duplicate-id',
          shape: 'box',
          positionM: [0, 0, 0],
          dimensionsM: [1, 1, 1],
        },
        {
          id: 'duplicate-id',
          shape: 'cylinder',
          positionM: [0, 1, 0],
          dimensionsM: [1, 1],
        },
      ],
    };
    expect(() => validateStructureArchetype(invalid)).toThrowError(
      /duplicate id "duplicate-id"/i,
    );
  });

  it('rejects solid dimension count mismatch', () => {
    const invalid: IStructureArchetype = {
      ...DEMO_RUNWAY_ARCHETYPE,
      solids: [
        {
          id: 'bad-box',
          shape: 'box',
          positionM: [0, 0, 0],
          dimensionsM: [1, 2], // Box requires 3 dimensions
        },
      ],
    };
    expect(() => validateStructureArchetype(invalid)).toThrowError(
      /expects 3 dimensions, got 2/,
    );
  });

  it('rejects invalid joint target', () => {
    const invalid: IStructureArchetype = {
      ...DEMO_RUNWAY_ARCHETYPE,
      joints: [
        {
          id: 'orphan-joint',
          linkId: 5, // No solid has linkId: 5
          anchorM: [0, 0, 0],
          axis: [0, 1, 0],
          range: [0, 1],
          rest: 0,
        },
      ],
    };
    expect(() => validateStructureArchetype(invalid)).toThrowError(
      /targets linkId 5 but no solids have this linkId/,
    );
  });
});
