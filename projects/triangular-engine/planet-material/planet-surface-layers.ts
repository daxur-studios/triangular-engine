import { float, vec3, vertexColor } from 'three/tsl';
import type { IPlanetContext } from './planet-context';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * What a surface layer produces and consumes. `albedo` is linear RGB.
 * `normalTS` is an optional tangent-space normal for layers that perturb the surface; the stock
 * material does not apply it until a layer needs it (Plan 050 Phase 2).
 */
export interface ISurfaceSample {
  albedo: any;
  roughness: any;
  metalness: any;
  normalTS?: any;
}

/** A surface layer: a pure function of the planet context and the sample below it. */
export type SurfaceLayer = (context: IPlanetContext, below: ISurfaceSample) => ISurfaceSample;

/** Sun occlusion: 0 = fully shadowed, 1 = fully lit. Occluders multiply. */
export type SunOcclusion = (context: IPlanetContext) => any;

/** Emissive contribution (linear RGB). Emissives add. */
export type EmissiveLayer = (context: IPlanetContext, surface: ISurfaceSample) => any;

/** Stock layer order. Game layers pick numbers around these. */
export const SURFACE_LAYER_ORDER = {
  base: 0,
  streamedMaterial: 100,
  cellLookup: 200,
  macroVariation: 300,
  /** Game layers (roads, decals, snow) conventionally sit from here up. */
  game: 1000,
} as const;

/** The base layer: per-vertex colour (linear, as the GLSL path reads it) with constant roughness/metalness. */
export function vertexColorLayer(
  options: { roughness?: number; metalness?: number } = {},
): SurfaceLayer {
  const roughness = options.roughness ?? 0.92;
  const metalness = options.metalness ?? 0.05;
  return () => ({
    albedo: vec3(vertexColor()),
    roughness: float(roughness),
    metalness: float(metalness),
  });
}
