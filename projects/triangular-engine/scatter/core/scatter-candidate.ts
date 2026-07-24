import { createScatterRandom01, hashScatterKey } from './scatter-hash';
import {
  composeScatterInstanceId,
  IScatterCellIdentity,
  ScatterInstanceId,
} from './scatter-instance-id';

export interface IScatterCandidate {
  readonly instanceId: ScatterInstanceId;
  readonly candidateIndex: number;
  /** Position within the cell's [0,1) x [0,1) parametric square. */
  readonly localU: number;
  readonly localV: number;
  /** Compared against effective density (0..1) by evaluateScatterPlacement. */
  readonly densitySeed01: number;
  readonly rotationSeed01: number;
  readonly scaleSeed01: number;
  readonly embedSeed01: number;
}

function candidateKey(candidateIndex: number): string {
  return `c${candidateIndex}`;
}

/**
 * Generates a cell's full, fixed-size candidate pool. Density is applied
 * later, as a threshold over densitySeed01 — regenerating with a different
 * density never moves or renumbers an existing candidate. The draw order
 * below (localU, localV, densitySeed01, rotationSeed01, scaleSeed01,
 * embedSeed01) is part of the layer's generatorVersion contract: changing it
 * is a breaking regeneration, same as changing candidatePoolSize.
 */
export function generateScatterCandidates(
  identity: IScatterCellIdentity,
  candidatePoolSize: number,
): readonly IScatterCandidate[] {
  const candidates: IScatterCandidate[] = [];
  for (
    let candidateIndex = 0;
    candidateIndex < candidatePoolSize;
    candidateIndex++
  ) {
    const key = candidateKey(candidateIndex);
    const seedKey = `${identity.worldSeed}|${identity.layerId}|${identity.speciesId}|${identity.generatorVersion}|${identity.cellKey}|${key}`;
    const random = createScatterRandom01(hashScatterKey(seedKey));
    candidates.push({
      instanceId: composeScatterInstanceId(identity, key),
      candidateIndex,
      localU: random(),
      localV: random(),
      densitySeed01: random(),
      rotationSeed01: random(),
      scaleSeed01: random(),
      embedSeed01: random(),
    });
  }
  return candidates;
}
