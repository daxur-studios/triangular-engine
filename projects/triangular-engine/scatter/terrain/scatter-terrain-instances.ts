import type {
  ITerrainField,
  ITerrainSurfaceDomain,
  TerrainVector3,
} from 'triangular-engine/terrain';
import { sampleTerrainSurface } from 'triangular-engine/terrain';

import { generateScatterCandidates } from '../core/scatter-candidate';
import { computeScatterDistanceFade01 } from '../core/scatter-distance-fade';
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

export interface IScatterDistanceFadeOptions {
  readonly viewpointWorldM: TerrainVector3;
  /** Density is unaffected inside this radius, then ramps linearly to 0 at fadeEndM. */
  readonly fadeStartM: number;
  readonly fadeEndM: number;
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
  /** For species with no far LOD (grass): density fades to zero instead of popping. */
  readonly distanceFade?: IScatterDistanceFadeOptions;
}

function distanceM(a: TerrainVector3, b: TerrainVector3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
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
      elevationM: sample.elevationM,
    };
    let suitability = options.suitability;
    if (options.distanceFade) {
      const { viewpointWorldM, fadeStartM, fadeEndM } = options.distanceFade;
      const fade01 = computeScatterDistanceFade01(
        distanceM(sample.worldPositionM, viewpointWorldM),
        fadeStartM,
        fadeEndM,
      );
      const baseSuitability = options.suitability;
      suitability = (s) => (baseSuitability ? baseSuitability(s) : 1) * fade01;
    }

    const placement = evaluateScatterPlacement(
      candidate,
      surfaceSample,
      options.rules,
      options.baseDensity01,
      suitability,
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
