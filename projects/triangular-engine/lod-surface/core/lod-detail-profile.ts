import type { LodDomain } from './lod-domain';
import { bakeHeights, type BakeLayout } from './lod-height-bake';
import { createTextureHeightSource, type TextureHeightSource } from './lod-height-texture';
import type { DetailWeights } from './lod-detail-noise';

/**
 * A terrain profile for the detail noise: where the sub-texel relief is strong, weak or absent. The noise itself is the same
 * everywhere (`lod-detail-noise.ts`); the profile is a per-point weight on its amplitude, so each game decides what its ground
 * is like: dead-flat meadows beside chiselled mountains, or restless ground everywhere.
 *
 * The game gives a callback over body-fixed positions (for a cell planet: look up the cell, then its biome). The engine bakes it
 * once into a small per-face weight texture, which the vertex stage and the CPU twin both read bilinearly, so the drawn ground and
 * `groundAt` agree and the weights fade smoothly across a biome border instead of stepping.
 */
export interface DetailProfile {
  /** Identity of the profile for caches: two profiles with the same id and the same `weightAt` must be interchangeable. */
  readonly id: string;
  /** Largest weight `weightAt` returns (at least 0); bounds the culling box. Results above it are clamped. */
  readonly maxWeight: number;
  /** Weight of the detail amplitude at a body-fixed position (domain frame, metres), in [0, maxWeight]. 0 is flat, 1 the plain amplitude. */
  weightAt(x: number, y: number, z: number): number;
  /** Weight texture size exponent: 2^k texel cells per face side. Default {@link DEFAULT_DETAIL_PROFILE_K}. */
  readonly k?: number;
}

/** 257 x 257 texels per face: a biome border is blended over a few kilometres on an Earth-sized body, cheap to bake and to hold. */
export const DEFAULT_DETAIL_PROFILE_K = 8;

/** The profile that gives every point the same weight: the same ground as no profile at all, scaled by `weight`. */
export const uniformDetailProfile = (weight = 1): DetailProfile => ({ id: `uniform:${weight}`, maxWeight: weight, weightAt: () => weight });

/** A baked weight field: read it on the CPU with `weights`, and in the vertex stage through `source.lattice`. Dispose it to free the GPU texture. */
export interface DetailWeightField {
  readonly profile: DetailProfile;
  readonly source: TextureHeightSource;
  readonly weights: DetailWeights;
}

/** Bakes `profile` over `domain` (synchronous: it is a few hundred thousand callback calls at the default size). */
export function bakeDetailProfile(domain: LodDomain, profile: DetailProfile): DetailWeightField {
  const max = Math.max(0, profile.maxWeight);
  const layout: BakeLayout = { kind: domain.kind, warp: domain.warp, sizeM: domain.sizeM, k: profile.k ?? DEFAULT_DETAIL_PROFILE_K };
  const baked = bakeHeights(layout, (x, y, z) => Math.min(max, Math.max(0, profile.weightAt(x, y, z))));
  const source = createTextureHeightSource('noise', baked);
  return { profile, source, weights: { maxWeight: max, weightAt: (x, y, z) => source.heightAt(x, y, z) } };
}
