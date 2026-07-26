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
  uCylinderHalfLength: { value: number };
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
    uCylinderHalfLength: { value: 1e20 },
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
  uniform float uCylinderHalfLength;
`;

/**
 * Rejects geometry outside a finite domain. A cylinder's camera-centred grid
 * may be wider than its circumference, so the local arc test also prevents
 * the same wall from being drawn repeatedly after wrapping through 2π.
 */
export const WATER_DOMAIN_CLIP_GLSL = `
  void waterDomainClip(vec3 worldPosition, vec2 localXZ) {
    #ifdef WATER_DOMAIN_CYLINDER
      float axial = dot(worldPosition - uCylinderCenter, uCylinderAxis);
      if (abs(axial) > uCylinderHalfLength) discard;
      if (abs(localXZ.y) > 3.141592653589793 * uCylinderRadius) discard;
    #endif
  }
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
      vec3 originRelative = uFrameOrigin - uCylinderCenter;
      float originAxial = dot(originRelative, uCylinderAxis);
      vec3 originRadial = normalize(
        originRelative - uCylinderAxis * originAxial
      );
      float angle = localXZ.y / uCylinderRadius;
      vec3 radialDirection =
        originRadial * cos(angle)
        + cross(uCylinderAxis, originRadial) * sin(angle);
      return uCylinderCenter
        + uCylinderAxis * (originAxial + localXZ.x)
        + radialDirection * (uCylinderRadius - heightAlongNormal);
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
  vec3 waterComposeWorldNormal(vec3 localNormal, vec2 localXZ) {
    #ifdef WATER_DOMAIN_SPHERE
      vec3 surfacePosition = waterComposeWorldPosition(localXZ, 0.0);
      vec3 domainUp = normalize(surfacePosition - uSphereCenter);
      vec3 tangentU = normalize(
        uFrameTangentU - domainUp * dot(uFrameTangentU, domainUp)
      );
      vec3 tangentV = normalize(cross(domainUp, tangentU));
      return normalize(
        tangentU * localNormal.x
        + domainUp * localNormal.y
        + tangentV * localNormal.z
      );
    #elif defined(WATER_DOMAIN_CYLINDER)
      vec3 surfacePosition = waterComposeWorldPosition(localXZ, 0.0);
      vec3 relative = surfacePosition - uCylinderCenter;
      vec3 radial = relative - uCylinderAxis * dot(relative, uCylinderAxis);
      vec3 domainUp = -normalize(radial);
      vec3 tangentAround = normalize(cross(domainUp, uCylinderAxis));
      return normalize(
        uCylinderAxis * localNormal.x
        + domainUp * localNormal.y
        + tangentAround * localNormal.z
      );
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
      float axial = dot(
        uFrameOrigin - uCylinderCenter,
        uCylinderAxis
      ) + localXZ.x;
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
