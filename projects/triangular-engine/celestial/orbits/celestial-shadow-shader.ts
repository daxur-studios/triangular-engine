/** Maximum generic occluders supported by the first receiver shader variant. */
export const CELESTIAL_SHADOW_MAX_OCCLUDERS = 8;

/** Renderer-neutral uniforms required by the spatial direct-light evaluator. */
export interface ICelestialShadowShaderUniforms {
  readonly sourceCenterM: readonly [number, number, number];
  readonly sourceRadiusM: number;
  readonly occluderCount: number;
  readonly occluderCentersM: readonly (readonly [number, number, number])[];
  readonly occluderRadiiM: readonly number[];
}

/**
 * GLSL helper for a receiver-local eclipse factor.
 *
 * The caller supplies camera-relative receiver and body positions in one
 * render frame. The CPU broad phase fills at most eight generic occluders;
 * no body ID or celestial kind is encoded in this shader.
 */
export const CELESTIAL_SHADOW_GLSL = /* glsl */ `
float celestialDiscRadius(float radiusM, float distanceM) {
  return asin(clamp(radiusM / max(distanceM, 1e-6), 0.0, 1.0));
}

float celestialDiscOverlap(float sourceRadius, float blockerRadius, float separation) {
  if (separation >= sourceRadius + blockerRadius) return 0.0;
  if (separation + blockerRadius <= sourceRadius)
    return clamp((blockerRadius * blockerRadius) / max(sourceRadius * sourceRadius, 1e-8), 0.0, 1.0);
  if (separation + sourceRadius <= blockerRadius) return 1.0;
  if (separation < 1e-6)
    return clamp(min(sourceRadius, blockerRadius) * min(sourceRadius, blockerRadius) / max(sourceRadius * sourceRadius, 1e-8), 0.0, 1.0);
  float sourceAngle = acos(clamp((separation * separation + sourceRadius * sourceRadius - blockerRadius * blockerRadius) / (2.0 * separation * sourceRadius), -1.0, 1.0));
  float blockerAngle = acos(clamp((separation * separation + blockerRadius * blockerRadius - sourceRadius * sourceRadius) / (2.0 * separation * blockerRadius), -1.0, 1.0));
  float triangle = 0.5 * sqrt(max(0.0, (-separation + sourceRadius + blockerRadius) * (separation + sourceRadius - blockerRadius) * (separation - sourceRadius + blockerRadius) * (separation + sourceRadius + blockerRadius)));
  return clamp((sourceRadius * sourceRadius * sourceAngle + blockerRadius * blockerRadius * blockerAngle - triangle) / max(3.14159265 * sourceRadius * sourceRadius, 1e-8), 0.0, 1.0);
}

float celestialDirectVisibility(vec3 receiverM, vec3 sourceCenterM, float sourceRadiusM, int occluderCount, vec3 occluderCentersM[8], float occluderRadiiM[8]) {
  vec3 sourceVector = sourceCenterM - receiverM;
  float sourceDistance = length(sourceVector);
  if (sourceDistance < 1e-6) return 1.0;
  float sourceAngularRadius = celestialDiscRadius(sourceRadiusM, sourceDistance);
  vec3 sourceDirection = normalize(sourceVector);
  float covered = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= occluderCount) break;
    vec3 blockerVector = occluderCentersM[i] - receiverM;
    float blockerDistance = length(blockerVector);
    // Ignore self-shadowing (when receiver is on the occluder itself) or when blocker is behind source
    if (blockerDistance <= occluderRadiiM[i] * 1.005 || blockerDistance >= sourceDistance) continue;
    
    vec3 blockerDirection = normalize(blockerVector);
    float dotProduct = dot(sourceDirection, blockerDirection);
    if (dotProduct <= 0.0) continue;

    float blockerAngularRadius = celestialDiscRadius(occluderRadiiM[i], blockerDistance);
    float separation = acos(clamp(dotProduct, -1.0, 1.0));
    covered = min(1.0, covered + celestialDiscOverlap(sourceAngularRadius, blockerAngularRadius, separation));
  }
  return 1.0 - covered;
}
`;
