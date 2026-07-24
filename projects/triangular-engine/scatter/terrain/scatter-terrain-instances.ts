import type {
  ITerrainField,
  ITerrainSurfaceDomain,
  TerrainVector3,
} from 'triangular-engine/terrain';
import { sampleTerrainSurface } from 'triangular-engine/terrain';

import { generateScatterCandidates } from '../core/scatter-candidate';
import type { IScatterCellIdentity, ScatterInstanceId } from '../core/scatter-instance-id';
import {
  evaluateScatterPlacement,
  type IScatterSurfaceSample,
  type ScatterSuitabilityFn,
} from '../core/scatter-placement';
import type { ScatterPlacementRules } from '../core/scatter-species-definition';

export interface ITerrainScatterInstance {
  readonly instanceId: ScatterInstanceId;
  readonly worldPositionM: TerrainVector3;
  readonly normal: TerrainVector3;
  readonly surfaceUp: TerrainVector3;
  readonly rotationSeed01: number;
  readonly scaleSeed01: number;
  readonly embedSeed01: number;
}

export interface IGenerateTerrainScatterInstancesOptions<TAddress> {
  readonly field: ITerrainField;
  readonly domain: ITerrainSurfaceDomain<TAddress>;
  readonly cellAddress: TAddress;
  readonly cellKey: string;
  readonly identity: Omit<IScatterCellIdentity, 'cellKey'>;
  readonly candidatePoolSize: number;
  readonly rules: ScatterPlacementRules;
  readonly baseDensity01: number;
  readonly suitability?: ScatterSuitabilityFn;
}

/**
 * Generates one terrain cell's accepted scatter instances: candidates come
 * from scatter/core (terrain-agnostic), each is placed via the canonical
 * terrain surface sampler so instances always sit on the same displaced
 * surface the terrain renders — never a shader-only approximation.
 */
export function generateTerrainScatterInstances<TAddress>(
  options: IGenerateTerrainScatterInstancesOptions<TAddress>,
): readonly ITerrainScatterInstance[] {
  const identity: IScatterCellIdentity = {
    ...options.identity,
    cellKey: options.cellKey,
  };
  const candidates = generateScatterCandidates(
    identity,
    options.candidatePoolSize,
  );
  const bounds = options.domain.getPatchBounds(options.cellAddress);
  const instances: ITerrainScatterInstance[] = [];

  for (const candidate of candidates) {
    const u = bounds.minU + candidate.localU * (bounds.maxU - bounds.minU);
    const v = bounds.minV + candidate.localV * (bounds.maxV - bounds.minV);
    const sample = sampleTerrainSurface(
      options.field,
      options.domain,
      options.cellAddress,
      u,
      v,
    );
    const surfaceSample: IScatterSurfaceSample = {
      worldPositionM: sample.worldPositionM,
      normal: sample.normal,
      surfaceUp: sample.surfaceUp,
      slope01: sample.slope01,
    };
    const placement = evaluateScatterPlacement(
      candidate,
      surfaceSample,
      options.rules,
      options.baseDensity01,
      options.suitability,
    );
    if (!placement.accepted) continue;

    instances.push({
      instanceId: candidate.instanceId,
      worldPositionM: sample.worldPositionM,
      normal: sample.normal,
      surfaceUp: sample.surfaceUp,
      rotationSeed01: candidate.rotationSeed01,
      scaleSeed01: candidate.scaleSeed01,
      embedSeed01: candidate.embedSeed01,
    });
  }

  return instances;
}
