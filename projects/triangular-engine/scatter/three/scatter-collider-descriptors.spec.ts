import { buildScatterColliderDescriptors } from './scatter-collider-descriptors';
import { createScatterRemovalOverlay } from '../core/scatter-removal-overlay';
import type { ITerrainScatterInstance } from '../terrain/scatter-terrain-instances';
import type { ScatterSpeciesDefinition } from '../core/scatter-species-definition';

function instance(overrides: Partial<ITerrainScatterInstance> = {}): ITerrainScatterInstance {
  return {
    instanceId: 'tree-1',
    worldPositionM: [100000, 5, -3],
    normal: [0, 1, 0],
    surfaceUp: [0, 1, 0],
    rotationSeed01: 0,
    scaleSeed01: 0.5,
    embedSeed01: 0,
    ...overrides,
  };
}

const baseSpecies: ScatterSpeciesDefinition = {
  id: 'pine',
  assetKey: 'pine',
  placement: { alignment: 'align-to-normal' },
  lods: [{ kind: 'mesh', maxDistanceM: 100, castShadow: true }],
  collider: { shape: 'box', params: [1, 2, 1], impactThresholdNs: 500 },
};

describe('buildScatterColliderDescriptors', () => {
  it('returns no descriptors when the species has no collider definition', () => {
    const { collider, ...noCollider } = baseSpecies;
    const result = buildScatterColliderDescriptors({
      cellKey: 'cell-a',
      anchorWorldM: [100000, 0, 0],
      instances: [instance()],
      species: noCollider,
      scale: { min: 1, max: 1 },
    });
    expect(result.descriptors).toEqual([]);
  });

  it('produces one descriptor per instance, positioned anchor-relative', () => {
    const result = buildScatterColliderDescriptors({
      cellKey: 'cell-a',
      anchorWorldM: [100000, 0, 0],
      instances: [instance()],
      species: baseSpecies,
      scale: { min: 1, max: 1 },
    });
    expect(result.descriptors.length).toBe(1);
    const [descriptor] = result.descriptors;
    expect(descriptor.instanceId).toBe('tree-1');
    expect(descriptor.speciesId).toBe('pine');
    expect(descriptor.anchorRelativePositionM[0]).toBeCloseTo(0, 5);
    expect(descriptor.anchorRelativePositionM[1]).toBeCloseTo(5, 5);
    expect(descriptor.anchorRelativePositionM[2]).toBeCloseTo(-3, 5);
  });

  it('keeps anchor-relative positions small even at a planetary-radius anchor', () => {
    const planetaryAnchor: readonly [number, number, number] = [6371000, 0, 0];
    const result = buildScatterColliderDescriptors({
      cellKey: 'cell-a',
      anchorWorldM: planetaryAnchor,
      instances: [instance({ worldPositionM: [6371004, 2, -1] })],
      species: baseSpecies,
      scale: { min: 1, max: 1 },
    });
    const [descriptor] = result.descriptors;
    expect(Math.abs(descriptor.anchorRelativePositionM[0])).toBeLessThan(10);
  });

  it('scales collider params by the instance uniform scale', () => {
    const result = buildScatterColliderDescriptors({
      cellKey: 'cell-a',
      anchorWorldM: [100000, 0, 0],
      instances: [instance({ scaleSeed01: 1 })],
      species: baseSpecies,
      scale: { min: 1, max: 3 },
    });
    const [descriptor] = result.descriptors;
    // scaleSeed01=1 lerps to max scale (3); params [1, 2, 1] -> [3, 6, 3]
    expect(descriptor.params[0]).toBeCloseTo(3, 5);
    expect(descriptor.params[1]).toBeCloseTo(6, 5);
    expect(descriptor.params[2]).toBeCloseTo(3, 5);
  });

  it('drops instances present in the removal overlay', () => {
    const overlay = createScatterRemovalOverlay(['tree-1']);
    const result = buildScatterColliderDescriptors({
      cellKey: 'cell-a',
      anchorWorldM: [100000, 0, 0],
      instances: [instance({ instanceId: 'tree-1' }), instance({ instanceId: 'tree-2' })],
      species: baseSpecies,
      scale: { min: 1, max: 1 },
      overlay,
    });
    expect(result.descriptors.map((d) => d.instanceId)).toEqual(['tree-2']);
  });

  it('carries the collider shape and impact threshold through', () => {
    const result = buildScatterColliderDescriptors({
      cellKey: 'cell-a',
      anchorWorldM: [100000, 0, 0],
      instances: [instance()],
      species: baseSpecies,
      scale: { min: 1, max: 1 },
    });
    const [descriptor] = result.descriptors;
    expect(descriptor.shape).toBe('box');
    expect(descriptor.impactThresholdNs).toBe(500);
  });
});
