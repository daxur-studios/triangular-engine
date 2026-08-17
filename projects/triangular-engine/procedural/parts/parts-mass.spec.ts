import { derivePartMassProperties } from './parts-mass';
import type { IPartSolid } from './parts-solid';

describe('parts-mass', () => {
  it('computes exact box volume and center of mass', () => {
    const solids: readonly IPartSolid[] = [
      {
        id: 'box-1',
        shape: 'box',
        positionM: [1, 2, 3],
        orientation: [0, 0, 0, 1],
        dimensionsM: [2, 3, 4], // volume = 24
        linkId: 0,
      },
    ];

    const massProps = derivePartMassProperties(solids, 1000);
    expect(massProps.volumeM3).toBeCloseTo(24, 3);
    expect(massProps.dryMassKg).toBeCloseTo(24000, 3);
    expect(massProps.centerOfMassM[0]).toBeCloseTo(1, 3);
    expect(massProps.centerOfMassM[1]).toBeCloseTo(2, 3);
    expect(massProps.centerOfMassM[2]).toBeCloseTo(3, 3);
  });

  it('computes exact composite center of mass across multiple symmetric solids', () => {
    const solids: readonly IPartSolid[] = [
      {
        id: 'left-box',
        shape: 'box',
        positionM: [-5, 0, 0],
        orientation: [0, 0, 0, 1],
        dimensionsM: [2, 2, 2], // volume = 8
        linkId: 0,
      },
      {
        id: 'right-box',
        shape: 'box',
        positionM: [5, 0, 0],
        orientation: [0, 0, 0, 1],
        dimensionsM: [2, 2, 2], // volume = 8
        linkId: 1,
      },
    ];

    const massProps = derivePartMassProperties(solids, 500);
    expect(massProps.volumeM3).toBeCloseTo(16, 3);
    expect(massProps.dryMassKg).toBeCloseTo(8000, 3);
    // Symmetric around origin -> COM X = 0
    expect(massProps.centerOfMassM[0]).toBeCloseTo(0, 3);
    expect(massProps.centerOfMassM[1]).toBeCloseTo(0, 3);
    expect(massProps.centerOfMassM[2]).toBeCloseTo(0, 3);

    // Link breakdowns
    const link0 = massProps.byLinkId.get(0);
    const link1 = massProps.byLinkId.get(1);
    expect(link0?.centerOfMassM[0]).toBeCloseTo(-5, 3);
    expect(link1?.centerOfMassM[0]).toBeCloseTo(5, 3);
  });
});
