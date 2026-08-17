import {
  type IPartArchetype,
  validatePartArchetype,
} from './parts-archetype';

describe('validatePartArchetype', () => {
  const validLegArchetype: IPartArchetype = {
    schemaVersion: 1,
    id: 'part-rocket-landing-leg',
    name: 'Rocket Landing Leg',
    solids: [
      {
        id: 'base-mount',
        shape: 'box',
        positionM: [0, 0, 0],
        dimensionsM: [0.3, 0.2, 0.3],
        linkId: 0,
        materialHex: '#4f545c',
        collidable: true,
      },
      {
        id: 'moving-strut',
        shape: 'cylinder',
        positionM: [0, -0.6, 0.4],
        dimensionsM: [[0.04, 0.06], [0.8, 1.2]],
        linkId: 1,
        materialHex: '#99aab5',
        collidable: true,
      },
    ],
    sockets: [
      { kind: 'attach', role: 'radial', solidId: 'base-mount' },
      { kind: 'pivot', solidId: 'base-mount' },
      { kind: 'foot', solidId: 'moving-strut' },
    ],
    collider: {
      hull: false,
      coneApproximation: 'cylinder',
    },
    joint: {
      anchorM: [0, 0, 0.15],
      axis: [1, 0, 0],
      rangeRad: [0, 1.2],
      restRad: 0,
    },
  };

  it('accepts a valid archetype', () => {
    expect(() => validatePartArchetype(validLegArchetype)).not.toThrow();
  });

  it('rejects an invalid schemaVersion', () => {
    const invalid = { ...validLegArchetype, schemaVersion: 0 as 1 };
    expect(() => validatePartArchetype(invalid)).toThrowError(
      /schemaVersion must be a positive integer/,
    );
  });

  it('rejects an empty id', () => {
    const invalid = { ...validLegArchetype, id: '' };
    expect(() => validatePartArchetype(invalid)).toThrowError(/id must be a non-empty string/);
  });

  it('rejects empty solids', () => {
    const invalid = { ...validLegArchetype, solids: [] };
    expect(() => validatePartArchetype(invalid)).toThrowError(/at least one solid/);
  });

  it('rejects duplicate solid ids', () => {
    const invalid: IPartArchetype = {
      ...validLegArchetype,
      solids: [
        validLegArchetype.solids[0],
        { ...validLegArchetype.solids[1], id: validLegArchetype.solids[0].id },
      ],
    };
    expect(() => validatePartArchetype(invalid)).toThrowError(/duplicate id/);
  });

  it('rejects unknown solid shape', () => {
    const invalid: IPartArchetype = {
      ...validLegArchetype,
      solids: [{ ...validLegArchetype.solids[0], shape: 'torus' as any }],
    };
    expect(() => validatePartArchetype(invalid)).toThrowError(/unknown shape/);
  });

  it('rejects dimension arity mismatch for shape', () => {
    const invalid: IPartArchetype = {
      ...validLegArchetype,
      solids: [{ ...validLegArchetype.solids[0], dimensionsM: [0.3, 0.2] }], // box needs 3
    };
    expect(() => validatePartArchetype(invalid)).toThrowError(/expects 3 dimensions/);
  });

  it('rejects non-positive dimensions', () => {
    const invalid: IPartArchetype = {
      ...validLegArchetype,
      solids: [{ ...validLegArchetype.solids[0], dimensionsM: [0.3, -0.2, 0.3] }],
    };
    expect(() => validatePartArchetype(invalid)).toThrowError(/positive/);
  });

  it('rejects joint when no solids have linkId >= 1', () => {
    const invalid: IPartArchetype = {
      ...validLegArchetype,
      solids: [
        validLegArchetype.solids[0],
        { ...validLegArchetype.solids[1], linkId: 0 },
      ],
    };
    expect(() => validatePartArchetype(invalid)).toThrowError(/no solids assigned to linkId >= 1/);
  });

  it('rejects joint with zero-length axis', () => {
    const invalid: IPartArchetype = {
      ...validLegArchetype,
      joint: { ...validLegArchetype.joint!, axis: [0, 0, 0] },
    };
    expect(() => validatePartArchetype(invalid)).toThrowError(/non-zero length/);
  });

  it('rejects joint with negative extensionM', () => {
    const invalid: IPartArchetype = {
      ...validLegArchetype,
      joint: { ...validLegArchetype.joint!, extensionM: -0.5 },
    };
    expect(() => validatePartArchetype(invalid)).toThrowError(/extensionM must be non-negative/);
  });

  it('rejects sockets referencing non-existent solidId', () => {
    const invalid: IPartArchetype = {
      ...validLegArchetype,
      sockets: [{ kind: 'attach', solidId: 'non-existent-solid' }],
    };
    expect(() => validatePartArchetype(invalid)).toThrowError(/non-existent solidId/);
  });
});

