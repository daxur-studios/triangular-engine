import { asin, atan, clamp, uv, vec2 } from 'three/tsl';
import {
  planetCameraDistance,
  type IPlanetMorphGraph,
  type IPlanetMorphUniforms,
} from './planet-morph-nodes';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The planet context every stage shares, built once per material. Fields are TSL nodes: vertex-stage
 * values arrive as varyings, so any stage can read them in the fragment stage.
 *
 * Plan 050 lists more fields (intrinsic height, cell id); those arrive with the layers that need them.
 */
export interface IPlanetContext {
  readonly uniforms: IPlanetMorphUniforms;
  /** 0 = sphere, 1 = flat map (a float uniform node). */
  readonly morph: any;
  /** Sphere-space unit direction (`aSphereNorm`). On terrain this is the surface normal and tilts with relief: use it for shading only. */
  readonly sphereNormal: any;
  /** Radial unit direction (planet centre to the shaded point): use it for geography, lat/lon and sun angle lookups. */
  readonly radialDirection: any;
  /** Morphed local position, before batching. */
  readonly morphedPosition: any;
  /** `vec2(lat, lon)` in radians, in the static map frame (`lon = atan2(x, z)`, as the CPU maps use). */
  readonly latLon: any;
  /** Unmorphed local position plus the batch translation (varying): stays welded to geography as the view morphs. */
  readonly bodyFixedLocal: any;
  /** Morphed local position plus the batch translation (varying). */
  readonly morphedBatchedLocal: any;
  readonly uv: any;
  /** Camera distance in the fragment stage. */
  readonly cameraDistance: any;
  readonly projectedLon: any;
  readonly seamCull: any;
}

export function createPlanetContext(
  uniforms: IPlanetMorphUniforms,
  graph: IPlanetMorphGraph,
): IPlanetContext {
  const n = graph.radialDirection;
  return {
    uniforms,
    morph: uniforms.uMorph,
    sphereNormal: graph.sphereNormal,
    radialDirection: n,
    morphedPosition: graph.morphedLocal,
    latLon: vec2(asin(clamp(n.y, -1, 1)), atan(n.x, n.z)),
    bodyFixedLocal: graph.bodyFixedLocal,
    morphedBatchedLocal: graph.morphedBatchedLocal,
    uv: uv(),
    cameraDistance: planetCameraDistance(),
    projectedLon: graph.projectedLon,
    seamCull: graph.seamCull,
  };
}
