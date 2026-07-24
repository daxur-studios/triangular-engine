import {
  ConstantTerrainField,
  PlaneTerrainDomain,
  type ITerrainField,
  type ITerrainFieldSample,
  type TerrainVector3,
} from 'triangular-engine/terrain';

import { generateTerrainScatterInstances } from './scatter-terrain-instances';
import type { IScatterCellIdentity } from '../core/scatter-instance-id';
import type { ScatterPlacementRules } from '../core/scatter-species-definition';

class RampField implements ITerrainField {
  readonly minElevationM = -1_000;
  readonly maxElevationM = 1_000;
  constructor(private readonly slope: number) {}
  sample([x]: TerrainVector3): ITerrainFieldSample {
    return { elevationM: this.slope * x };
  }
  sampleBatch(positions: Float64Array, out?: Float64Array): Float64Array {
    const output = out ?? new Float64Array(positions.length / 3);
    for (let i = 0; i < output.length; i++) {
      output[i] = this.slope * positions[i * 3];
    }
    return output;
  }
}

describe('generateTerrainScatterInstances', () => {
  const domain = new PlaneTerrainDomain(100);
  const address = { level: 0, x: 0, z: 0 };
  const identity: Omit<IScatterCellIdentity, 'cellKey'> = {
    worldSeed: 7,
    layerId: 'trees',
    speciesId: 'pine',
    generatorVersion: 1,
  };
  const rules: ScatterPlacementRules = { alignment: 'align-to-normal' };

  it('returns the full candidate pool on flat ground with density 1', () => {
    const instances = generateTerrainScatterInstances({
      field: new ConstantTerrainField(0),
      domain,
      cellAddress: address,
      cellKey: 'plane:0:0:0',
      identity,
      candidatePoolSize: 16,
      rules,
      baseDensity01: 1,
    });
    expect(instances.length).toBe(16);
    for (const instance of instances) {
      expect(instance.worldPositionM[0]).toBeGreaterThanOrEqual(0);
      expect(instance.worldPositionM[0]).toBeLessThanOrEqual(100);
      expect(instance.worldPositionM[2]).toBeGreaterThanOrEqual(-100);
      expect(instance.worldPositionM[2]).toBeLessThanOrEqual(0);
    }
  });

  it('returns nothing at density 0', () => {
    const instances = generateTerrainScatterInstances({
      field: new ConstantTerrainField(0),
      domain,
      cellAddress: address,
      cellKey: 'plane:0:0:0',
      identity,
      candidatePoolSize: 16,
      rules,
      baseDensity01: 0,
    });
    expect(instances.length).toBe(0);
  });

  it('rejects every candidate when the slope window excludes the actual slope', () => {
    const slopedRules: ScatterPlacementRules = { ...rules, slopeMax01: 0 };
    const instances = generateTerrainScatterInstances({
      field: new RampField(1),
      domain,
      cellAddress: address,
      cellKey: 'plane:0:0:0',
      identity,
      candidatePoolSize: 16,
      rules: slopedRules,
      baseDensity01: 1,
    });
    expect(instances.length).toBe(0);
  });

  it('is fully deterministic for identical inputs', () => {
    const options = {
      field: new ConstantTerrainField(3),
      domain,
      cellAddress: address,
      cellKey: 'plane:0:0:0',
      identity,
      candidatePoolSize: 12,
      rules,
      baseDensity01: 0.5,
    };
    const first = generateTerrainScatterInstances(options);
    const second = generateTerrainScatterInstances(options);
    expect(first).toEqual(second as unknown as typeof first);
  });
});
