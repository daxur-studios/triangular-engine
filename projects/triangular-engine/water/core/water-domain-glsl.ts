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
  uFrameOriginAngle: { value: number };
  uFrameNormal: { value: Vector3 };
  uFrameTangentU: { value: Vector3 };
  uFrameTangentV: { value: Vector3 };
  uSphereCenter: { value: Vector3 };
  uSphereRadius: { value: number };
  uCylinderCenter: { value: Vector3 };
  uCylinderAxis: { value: Vector3 };
  uCylinderRadius: { value: number };
}

/** Builds a fresh uniforms object; consumers overwrite the frame/sphere/cylinder values every frame. */
export function createWaterDomainUniforms(): WaterDomainUniforms {
  return {
    uFrameOrigin: { value: new Vector3(0, 0, 0) },
    uFrameOriginAngle: { value: 0 },
    uFrameNormal: { value: new Vector3(0, 1, 0) },
    uFrameTangentU: { value: new Vector3(1, 0, 0) },
    uFrameTangentV: { value: new Vector3(0, 0, 1) },
    uSphereCenter: { value: new Vector3(0, 0, 0) },
    uSphereRadius: { value: 1 },
    uCylinderCenter: { value: new Vector3(0, 0, 0) },
    uCylinderAxis: { value: new Vector3(0, 1, 0) },
    uCylinderRadius: { value: 1 },
  };
}

export const WATER_DOMAIN_UNIFORMS_GLSL = `
  uniform vec3 uFrameOrigin;
  uniform float uFrameOriginAngle;
  uniform vec3 uFrameNormal;
  uniform vec3 uFrameTangentU;
  uniform vec3 uFrameTangentV;
  uniform vec3 uSphereCenter;
  uniform float uSphereRadius;
  uniform vec3 uCylinderCenter;
  uniform vec3 uCylinderAxis;
  uniform float uCylinderRadius;
`;

/**
 * Flattens local tangent-plane coordinates into the tangent plane, then
 * renormalizes onto the curved domain (sphere or cylinder), which is what
 * makes the surface actually curve with the horizon rather than just tilt
 * to match local "up". The cylinder branch maps arc length directly into 360-degree
 * angle space around the cylinder wall.
 */
export const WATER_DOMAIN_COMPOSE_GLSL = `
  vec3 waterComposeWorldPosition(vec2 localXZ, float heightAlongNormal) {
    #ifdef WATER_DOMAIN_SPHERE
      vec3 flatPos = uFrameOrigin
        + uFrameTangentU * localXZ.x
        + uFrameTangentV * localXZ.y;
      vec3 direction = normalize(flatPos - uSphereCenter);
      return uSphereCenter + direction * (uSphereRadius + heightAlongNormal);
    #elif defined(WATER_DOMAIN_CYLINDER)
      float angle = uFrameOriginAngle + localXZ.y / uCylinderRadius;
      float displacedRadius = uCylinderRadius - heightAlongNormal;
      float axialComponent = uFrameOrigin.x + localXZ.x;
      vec3 localCyl = vec3(
        axialComponent,
        -displacedRadius * cos(angle),
        displacedRadius * sin(angle)
      );
      return uCylinderCenter + uCylinderAxis * localCyl.x + vec3(0.0, localCyl.y, localCyl.z);
    #else
      vec3 flatPos = uFrameOrigin
        + uFrameTangentU * localXZ.x
        + uFrameTangentV * localXZ.y;
      return flatPos + uFrameNormal * heightAlongNormal;
    #endif
  }
`;

/**
 * Transforms a normal expressed in the frame's own local axes into world space.
 */
export const WATER_DOMAIN_COMPOSE_NORMAL_GLSL = `
  vec3 waterComposeWorldNormal(vec3 localNormal) {
    #ifdef WATER_DOMAIN_CYLINDER
      float angle = uFrameOriginAngle + vLocalXZ.y / uCylinderRadius;
      vec3 rotNormal = vec3(
        localNormal.x,
        localNormal.y * cos(angle) - localNormal.z * sin(angle),
        localNormal.y * sin(angle) + localNormal.z * cos(angle)
      );
      return normalize(rotNormal);
    #else
      return normalize(
        uFrameTangentU * localNormal.x +
        uFrameNormal * localNormal.y +
        uFrameTangentV * localNormal.z
      );
    #endif
  }
`;

/**
 * Maps local tangent-plane coordinates (localXZ) into fixed, domain-anchored
 * surface coordinates (surfXZ).
 */
export const WATER_DOMAIN_SURFACE_XZ_GLSL = `
  vec2 waterDomainSurfaceXZ(vec2 localXZ) {
    #ifdef WATER_DOMAIN_CYLINDER
      float angle = uFrameOriginAngle + localXZ.y / uCylinderRadius;
      float axial = uFrameOrigin.x + localXZ.x;
      return vec2(axial, uCylinderRadius * angle);
    #elif defined(WATER_DOMAIN_SPHERE)
      vec3 flatPos = uFrameOrigin
        + uFrameTangentU * localXZ.x
        + uFrameTangentV * localXZ.y;
      vec3 dir = normalize(flatPos - uSphereCenter);
      float lat = asin(clamp(dir.y, -1.0, 1.0));
      float lon = atan(dir.z, dir.x);
      return vec2(uSphereRadius * lon, uSphereRadius * lat);
    #else
      vec3 flatPos = uFrameOrigin
        + uFrameTangentU * localXZ.x
        + uFrameTangentV * localXZ.y;
      return flatPos.xz;
    #endif
  }
`;
