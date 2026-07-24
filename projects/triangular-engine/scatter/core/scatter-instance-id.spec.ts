import {
  composeScatterInstanceId,
  IScatterCellIdentity,
} from './scatter-instance-id';

describe('composeScatterInstanceId', () => {
  const identity: IScatterCellIdentity = {
    worldSeed: 1234,
    layerId: 'trees',
    speciesId: 'pine',
    generatorVersion: 1,
    cellKey: 'plane:0:3:-2',
  };

  it('joins every identity field plus the candidate key', () => {
    expect(composeScatterInstanceId(identity, 'c7')).toBe(
      '1234::trees::pine::1::plane:0:3:-2::c7',
    );
  });

  it('changes when any single identity field changes', () => {
    const base = composeScatterInstanceId(identity, 'c0');
    expect(
      composeScatterInstanceId({ ...identity, worldSeed: 4321 }, 'c0'),
    ).not.toBe(base);
    expect(
      composeScatterInstanceId({ ...identity, layerId: 'grass' }, 'c0'),
    ).not.toBe(base);
    expect(
      composeScatterInstanceId({ ...identity, speciesId: 'oak' }, 'c0'),
    ).not.toBe(base);
    expect(
      composeScatterInstanceId({ ...identity, generatorVersion: 2 }, 'c0'),
    ).not.toBe(base);
    expect(
      composeScatterInstanceId({ ...identity, cellKey: 'plane:0:3:-1' }, 'c0'),
    ).not.toBe(base);
  });

  it('changes when only the candidate key changes', () => {
    expect(composeScatterInstanceId(identity, 'c0')).not.toBe(
      composeScatterInstanceId(identity, 'c1'),
    );
  });
});
