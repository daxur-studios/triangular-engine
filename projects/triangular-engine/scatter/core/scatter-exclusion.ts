import type { TerrainVector3 } from 'triangular-engine/terrain';

function distanceM(a: TerrainVector3, b: TerrainVector3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * A world-space circular no-scatter area — a building footprint, a road
 * corridor cross-section, anything that should locally suppress density.
 * World-space distance (not a surface-local rectangle) so the same zone
 * shape works unmodified on any terrain shape, same reasoning as
 * `computeScatterHorizonFade01` in `scatter-view-cull.ts` — see
 * docs/runbook/018 for why a rectangle was considered and deferred.
 */
export interface IScatterExclusionZone {
  readonly centerWorldM: TerrainVector3;
  readonly radiusM: number;
  /** Soft-edge ramp width beyond radiusM before returning to full suitability (0 = hard edge). */
  readonly featherM?: number;
}

function zoneFade01(distM: number, radiusM: number, featherM: number): number {
  if (distM <= radiusM) return 0;
  if (featherM <= 0 || distM >= radiusM + featherM) return 1;
  return (distM - radiusM) / featherM;
}

/**
 * 1 outside every zone, 0 inside a zone's core, ramping over its feather
 * band. Multiple zones combine via minimum (the most-restrictive zone
 * wins), not a product — overlapping feather rings shouldn't compound into
 * extra suppression beyond what either zone alone would apply.
 */
export function computeScatterExclusionFade01(
  candidateWorldPositionM: TerrainVector3,
  zones: readonly IScatterExclusionZone[],
): number {
  let fade01 = 1;
  for (const zone of zones) {
    const distM = distanceM(candidateWorldPositionM, zone.centerWorldM);
    const zoneFade = zoneFade01(distM, zone.radiusM, zone.featherM ?? 0);
    if (zoneFade < fade01) fade01 = zoneFade;
    if (fade01 === 0) return 0;
  }
  return fade01;
}
