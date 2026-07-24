import { Quaternion, Vector3 } from 'three';

import { computeScatterInstanceMatrix } from './scatter-instance-transform';
import type { ITerrainScatterInstance } from '../terrain/scatter-terrain-instances';
import type { ScatterPlacementRules } from '../core/scatter-species-definition';

function instance(
  overrides: Partial<ITerrainScatterInstance> = {},
): ITerrainScatterInstance {
  return {
    instanceId: 'test',
    worldPositionM: [10, 5, -3],
    normal: [0, 1, 0],
    surfaceUp: [0, 1, 0],
    rotationSeed01: 0,
    scaleSeed01: 0.5,
    embedSeed01: 0,
    ...overrides,
  };
}

describe('computeScatterInstanceMatrix', () => {
  const alignToNormal: ScatterPlacementRules = { alignment: 'align-to-normal' };

  it('places the instance at worldPositionM relative to the anchor', () => {
    const matrix = computeScatterInstanceMatrix(
      instance(),
      alignToNormal,
      { min: 1, max: 3 },
      [0, 0, 0],
    );
    const position = new Vector3();
    matrix.decompose(position, new Quaternion(), new Vector3());
    expect(position.x).toBeCloseTo(10, 6);
    expect(position.y).toBeCloseTo(5, 6);
    expect(position.z).toBeCloseTo(-3, 6);
  });

  it('subtracts the anchor from the instance position', () => {
    const matrix = computeScatterInstanceMatrix(
      instance(),
      alignToNormal,
      { min: 1, max: 3 },
      [10, 0, 0],
    );
    const position = new Vector3();
    matrix.decompose(position, new Quaternion(), new Vector3());
    expect(position.x).toBeCloseTo(0, 6);
  });

  it('lerps scale between min and max using scaleSeed01', () => {
    const matrix = computeScatterInstanceMatrix(
      instance({ scaleSeed01: 0.5 }),
      alignToNormal,
      { min: 1, max: 3 },
      [0, 0, 0],
    );
    const scale = new Vector3();
    matrix.decompose(new Vector3(), new Quaternion(), scale);
    expect(scale.x).toBeCloseTo(2, 6);
    expect(scale.y).toBeCloseTo(2, 6);
    expect(scale.z).toBeCloseTo(2, 6);
  });

  it('yields a near-identity rotation when normal is up and rotationSeed01 is 0', () => {
    const matrix = computeScatterInstanceMatrix(
      instance(),
      alignToNormal,
      { min: 1, max: 1 },
      [0, 0, 0],
    );
    const rotation = new Quaternion();
    matrix.decompose(new Vector3(), rotation, new Vector3());
    expect(Math.abs(rotation.w)).toBeCloseTo(1, 5);
  });

  it('aligns to surfaceUp instead of normal for align-to-surface-up', () => {
    const rules: ScatterPlacementRules = { alignment: 'align-to-surface-up' };
    const matrix = computeScatterInstanceMatrix(
      instance({ normal: [1, 0, 0], surfaceUp: [0, 1, 0] }),
      rules,
      { min: 1, max: 1 },
      [0, 0, 0],
    );
    const rotation = new Quaternion();
    matrix.decompose(new Vector3(), rotation, new Vector3());
    expect(Math.abs(rotation.w)).toBeCloseTo(1, 5);
  });

  it('embeds the instance along the normal by embedDepthM', () => {
    const rules: ScatterPlacementRules = {
      alignment: 'align-to-normal',
      embedDepthM: 2,
    };
    const matrix = computeScatterInstanceMatrix(
      instance({ normal: [0, 1, 0] }),
      rules,
      { min: 1, max: 1 },
      [0, 0, 0],
    );
    const position = new Vector3();
    matrix.decompose(position, new Quaternion(), new Vector3());
    expect(position.y).toBeCloseTo(3, 6);
  });

  it('produces a deterministic unit-length rotation for random-tumble', () => {
    const rules: ScatterPlacementRules = { alignment: 'random-tumble' };
    const data = instance({ rotationSeed01: 0.3, scaleSeed01: 0.7, embedSeed01: 0.2 });
    const a = computeScatterInstanceMatrix(data, rules, { min: 1, max: 1 }, [0, 0, 0]);
    const b = computeScatterInstanceMatrix(data, rules, { min: 1, max: 1 }, [0, 0, 0]);
    expect(a.toArray()).toEqual(b.toArray());
    const rotation = new Quaternion();
    a.decompose(new Vector3(), rotation, new Vector3());
    expect(rotation.length()).toBeCloseTo(1, 5);
  });
});
