import { Vector3 } from 'three';

/**
 * GLSL counterpart to `water-domain.ts`'s `WaterSurfaceDomain`: the vertex
 * shader's final step, composing local tangent-plane coordinates (the same
 * space `computeWaterLodLevels`/`WATER_LOD_MORPH_GLSL`/`GERSTNER_*_GLSL`
 * already operate in) plus a height along the frame's normal into a world
 * position. Branches at compile time on `WATER_DOMAIN_SPHERE` (define it on
 * the material for a curved domain; omit it for the flat plane path), the
 * same pattern `water-shading-glsl.ts` uses for `USE_LOGARITHMIC_DEPTH_BUFFER`.
 */

export interface WaterDomainUniforms {
  uFrameOrigin: { value: Vector3 };
  uFrameNormal: { value: Vector3 };
  uFrameTangentU: { value: Vector3 };
  uFrameTangentV: { value: Vector3 };
  uSphereCenter: { value: Vector3 };
  uSphereRadius: { value: number };
}

/** Builds a fresh uniforms object; consumers overwrite the frame/sphere values every frame. */
export function createWaterDomainUniforms(): WaterDomainUniforms {
  return {
    uFrameOrigin: { value: new Vector3(0, 0, 0) },
    uFrameNormal: { value: new Vector3(0, 1, 0) },
    uFrameTangentU: { value: new Vector3(1, 0, 0) },
    uFrameTangentV: { value: new Vector3(0, 0, 1) },
    uSphereCenter: { value: new Vector3(0, 0, 0) },
    uSphereRadius: { value: 1 },
  };
}

export const WATER_DOMAIN_UNIFORMS_GLSL = `
  uniform vec3 uFrameOrigin;
  uniform vec3 uFrameNormal;
  uniform vec3 uFrameTangentU;
  uniform vec3 uFrameTangentV;
  uniform vec3 uSphereCenter;
  uniform float uSphereRadius;
`;

/**
 * Flattens local tangent-plane coordinates into the tangent plane, then —
 * only on the sphere branch — renormalizes the result onto the sphere at
 * `uSphereRadius + heightAlongNormal`, which is what makes the surface
 * actually curve with the horizon rather than just tilt to match local "up".
 * The plane branch is a plain linear combination (no renormalize), matching
 * `PlaneWaterDomain.composeWorldPosition` exactly.
 */
export const WATER_DOMAIN_COMPOSE_GLSL = `
  vec3 waterComposeWorldPosition(vec2 localXZ, float heightAlongNormal) {
    vec3 flatPos = uFrameOrigin
      + uFrameTangentU * localXZ.x
      + uFrameTangentV * localXZ.y;
    #ifdef WATER_DOMAIN_SPHERE
      vec3 direction = normalize(flatPos - uSphereCenter);
      return uSphereCenter + direction * (uSphereRadius + heightAlongNormal);
    #else
      return flatPos + uFrameNormal * heightAlongNormal;
    #endif
  }
`;

/**
 * Transforms a normal expressed in the frame's own local axes (x along
 * `uFrameTangentU`, y along `uFrameNormal`, z along `uFrameTangentV` — the
 * same convention `GERSTNER_NORMAL_GLSL`'s `gerstnerNormal()` already uses
 * for its 2D `base` + "up" parametrisation) into world space. Domain-
 * agnostic and un-branched: unlike position composition, curvature never
 * enters normal composition once the local frame is known, so this one
 * formula is correct for both the plane (identity, since its frame axes
 * already equal world X/Y/Z) and sphere domains. Consumers that perturb the
 * normal (e.g. `WATER_DETAIL_NORMAL_GLSL`'s scrolling chop, which assumes
 * its base normal is near-vertical) must perturb the *local* normal and
 * compose afterward, not perturb an already-composed world normal — on a
 * sphere, world "near-vertical" only holds at one point, the frame's own
 * origin.
 */
export const WATER_DOMAIN_COMPOSE_NORMAL_GLSL = `
  vec3 waterComposeWorldNormal(vec3 localNormal) {
    return normalize(
      uFrameTangentU * localNormal.x +
      uFrameNormal * localNormal.y +
      uFrameTangentV * localNormal.z
    );
  }
`;
