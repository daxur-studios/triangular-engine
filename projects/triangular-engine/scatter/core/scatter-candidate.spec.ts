import { generateScatterCandidates } from './scatter-candidate';
import { IScatterCellIdentity } from './scatter-instance-id';

describe('generateScatterCandidates', () => {
  const identity: IScatterCellIdentity = {
    worldSeed: 99,
    layerId: 'trees',
    speciesId: 'pine',
    generatorVersion: 1,
    cellKey: 'plane:0:3:-2',
  };

  it('returns exactly candidatePoolSize candidates with sequential indices', () => {
    const candidates = generateScatterCandidates(identity, 8);
    expect(candidates.length).toBe(8);
    expect(candidates.map((c) => c.candidateIndex)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it('gives every candidate a unique instance ID', () => {
    const candidates = generateScatterCandidates(identity, 32);
    const ids = new Set(candidates.map((c) => c.instanceId));
    expect(ids.size).toBe(32);
  });

  it('is fully deterministic for identical inputs', () => {
    const first = generateScatterCandidates(identity, 16);
    const second = generateScatterCandidates(identity, 16);
    expect(first).toEqual(second as unknown as typeof first);
  });

  it('keeps every seeded field within [0, 1)', () => {
    const candidates = generateScatterCandidates(identity, 20);
    for (const candidate of candidates) {
      for (const value of [
        candidate.localU,
        candidate.localV,
        candidate.densitySeed01,
        candidate.rotationSeed01,
        candidate.scaleSeed01,
        candidate.embedSeed01,
      ]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    }
  });

  it('never renumbers earlier candidates when the pool grows', () => {
    const small = generateScatterCandidates(identity, 4);
    const grown = generateScatterCandidates(identity, 8);
    expect(grown.slice(0, 4)).toEqual(small as unknown as typeof grown);
  });

  it('changes every candidate when the cell key changes', () => {
    const here = generateScatterCandidates(identity, 4);
    const there = generateScatterCandidates(
      { ...identity, cellKey: 'plane:0:3:-1' },
      4,
    );
    for (let i = 0; i < here.length; i++) {
      expect(here[i].instanceId).not.toBe(there[i].instanceId);
      expect(here[i].localU).not.toBe(there[i].localU);
    }
  });

  it('changes every candidate when the species differs, even in the same cell', () => {
    const pine = generateScatterCandidates(identity, 4);
    const oak = generateScatterCandidates(
      { ...identity, speciesId: 'oak' },
      4,
    );
    for (let i = 0; i < pine.length; i++) {
      expect(pine[i].localU).not.toBe(oak[i].localU);
    }
  });
});
