import type {
  ITerrainField,
  ITerrainSurfaceDomain,
  TerrainVector3,
} from 'triangular-engine/terrain';
import { sampleTerrainSurface } from 'triangular-engine/terrain';

import { generateScatterCandidates } from '../core/scatter-candidate';
import { computeScatterDistanceFade01 } from '../core/scatter-distance-fade';
import { computeScatterExclusionFade01, type IScatterExclusionZone } from '../core/scatter-exclusion';
import type { IScatterCellIdentity, ScatterInstanceId } from '../core/scatter-instance-id';
import {
  evaluateScatterPlacement,
  type IScatterSurfaceSample,
  type ScatterSuitabilityFn,
} from '../core/scatter-placement';
import type { ScatterPlacementRules } from '../core/scatter-species-definition';
import { computeScatterHorizonFade01, computeScatterViewConeFade01 } from '../core/scatter-view-cull';

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

/**
 * Camera-aware culling: a conservative cone in front of the camera, plus an
 * optional sphere-curvature horizon test. See
 * `computeScatterViewConeFade01`/`computeScatterHorizonFade01` in
 * `scatter/core/scatter-view-cull` for the math and docs/runbook/017 for the
 * design rationale (not a true 6-plane frustum; horizon is sphere-only).
 */
export interface IScatterViewCullOptions {
  readonly viewpointWorldM: TerrainVector3;
  readonly viewForwardM: TerrainVector3;
  readonly coneHalfAngleRad: number;
  /** Widens both the cone and horizon boundary so wide objects near the edge aren't dropped for a single center point. */
  readonly objectRadiusM?: number;
  readonly horizon?: {
    readonly curvatureCenterWorldM: TerrainVector3;
    readonly curvatureRadiusM: number;
    readonly marginRad?: number;
  };
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
  /** Drops instances outside a camera-relative cone (and optionally beyond a sphere horizon) — composes with distanceFade, not a replacement for it. */
  readonly viewCull?: IScatterViewCullOptions;
  /** Static no-scatter areas (building footprints, road corridors) — composes with distanceFade/viewCull. See `computeScatterExclusionFade01` and docs/runbook/018. */
  readonly exclusion?: readonly IScatterExclusionZone[];
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
      const baseSuitability = suitability;
      suitability = (s) => (baseSuitability ? baseSuitability(s) : 1) * fade01;
    }
    if (options.viewCull) {
      const { viewpointWorldM, viewForwardM, coneHalfAngleRad, objectRadiusM, horizon } =
        options.viewCull;
      let cullFade01 = computeScatterViewConeFade01(
        sample.worldPositionM,
        viewpointWorldM,
        viewForwardM,
        coneHalfAngleRad,
        objectRadiusM,
      );
      if (cullFade01 > 0 && horizon) {
        cullFade01 *= computeScatterHorizonFade01(
          sample.worldPositionM,
          viewpointWorldM,
          horizon.curvatureCenterWorldM,
          horizon.curvatureRadiusM,
          objectRadiusM,
          horizon.marginRad,
        );
      }
      const baseSuitability = suitability;
      suitability = (s) => (baseSuitability ? baseSuitability(s) : 1) * cullFade01;
    }
    if (options.exclusion && options.exclusion.length > 0) {
      const exclusionFade01 = computeScatterExclusionFade01(sample.worldPositionM, options.exclusion);
      const baseSuitability = suitability;
      suitability = (s) => (baseSuitability ? baseSuitability(s) : 1) * exclusionFade01;
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
