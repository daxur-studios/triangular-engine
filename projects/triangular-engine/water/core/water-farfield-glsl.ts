import { Color, type Texture } from 'three';

export interface WaterFarFieldShaderOptions {
  readonly detailNormalMap?: Texture | null;
  readonly cascadeCount?: number;
  readonly cascadeSpread?: number;
  readonly glintStrength?: number;
  readonly distanceRoughness?: number;
  readonly horizonBlendDistance?: number;
}

export interface WaterFarFieldUniforms {
  uFarCascadeCount: { value: number };
  uFarCascadeSpread: { value: number };
  uGlintStrength: { value: number };
  uDistanceRoughness: { value: number };
  uHorizonBlendDistance: { value: number };
  uFarColor: { value: Color };
}

export function createWaterFarFieldUniforms(
  options: WaterFarFieldShaderOptions = {},
): WaterFarFieldUniforms {
  return {
    uFarCascadeCount: {
      value: Math.max(1, Math.min(3, Math.round(options.cascadeCount ?? 3))),
    },
    uFarCascadeSpread: { value: Math.max(options.cascadeSpread ?? 8, 1.01) },
    uGlintStrength: { value: Math.max(options.glintStrength ?? 0, 0) },
    uDistanceRoughness: {
      value: Math.max(options.distanceRoughness ?? 0.45, 0),
    },
    uHorizonBlendDistance: {
      value: Math.max(options.horizonBlendDistance ?? 4000, 0.0001),
    },
    uFarColor: { value: new Color('#91b8cb') },
  };
}

/**
 * CPU port of the shader's cascade weighting. Keeping this public makes the
 * most important far-field invariant (weights partition unity) cheap to test.
 */
export function waterDetailCascadeWeights(
  distance: number,
  spread = 8,
  count = 3,
): readonly [number, number, number] {
  const safeCount = Math.max(1, Math.min(3, Math.round(count)));
  if (safeCount === 1) return [1, 0, 0];
  const coordinate = Math.max(
    0,
    Math.min(safeCount - 1, Math.log(Math.max(distance, 1)) / Math.log(Math.max(spread, 1.01))),
  );
  const lower = Math.min(Math.floor(coordinate), safeCount - 1);
  const upper = Math.min(lower + 1, safeCount - 1);
  const fraction = coordinate - lower;
  const weights: [number, number, number] = [0, 0, 0];
  weights[lower] += 1 - fraction;
  weights[upper] += fraction;
  return weights;
}

export function waterDistanceRoughness(
  distance: number,
  horizonBlendDistance: number,
  strength: number,
): number {
  const distance01 = Math.max(
    0,
    Math.min(1, distance / Math.max(horizonBlendDistance, 0.0001)),
  );
  return Math.max(0, Math.min(1, distance01 * Math.max(strength, 0)));
}

/** A lower threshold at distance keeps sparse glints visible as detail mips out. */
export function waterGlintThreshold(
  distance: number,
  horizonBlendDistance: number,
): number {
  const distance01 = Math.max(
    0,
    Math.min(1, distance / Math.max(horizonBlendDistance, 0.0001)),
  );
  return 0.94 - distance01 * 0.16;
}

export const WATER_FAR_FIELD_UNIFORMS_GLSL = `
  uniform float uFarCascadeCount;
  uniform float uFarCascadeSpread;
  uniform float uGlintStrength;
  uniform float uDistanceRoughness;
  uniform float uHorizonBlendDistance;
  uniform vec3 uFarColor;
`;

export const WATER_DETAIL_CASCADE_GLSL = `
  vec3 waterCascadeWeights(float distanceToCamera) {
    float count = clamp(floor(uFarCascadeCount + 0.5), 1.0, 3.0);
    float coordinate = clamp(
      log(max(distanceToCamera, 1.0)) / log(max(uFarCascadeSpread, 1.01)),
      0.0,
      count - 1.0
    );
    float lower = floor(coordinate);
    float fraction = coordinate - lower;
    vec3 weights = vec3(0.0);
    weights.x = (lower < 0.5 ? 1.0 - fraction : 0.0);
    weights.y =
      (lower > 0.5 && lower < 1.5 ? 1.0 - fraction : 0.0) +
      (lower < 0.5 && count > 1.5 ? fraction : 0.0);
    weights.z =
      (lower > 1.5 ? 1.0 : 0.0) +
      (lower > 0.5 && lower < 1.5 && count > 2.5 ? fraction : 0.0);
    return weights / max(weights.x + weights.y + weights.z, 0.0001);
  }

  vec3 waterDetailCascadeNormal(
    vec2 surfaceXZ,
    vec3 baseNormal,
    float t,
    float distanceToCamera
  ) {
    vec3 weights = waterCascadeWeights(distanceToCamera);
    vec2 scroll = uDetailScrollSpeed * t;
    vec3 sampleA = texture2D(uDetailNormalMap, surfaceXZ / uDetailTiling + scroll).rgb;
    vec3 sampleB = texture2D(uDetailNormalMap, surfaceXZ / (uDetailTiling * uFarCascadeSpread) - scroll * 0.7).rgb;
    vec3 sampleC = texture2D(uDetailNormalMap, surfaceXZ / (uDetailTiling * uFarCascadeSpread * uFarCascadeSpread) + scroll * 0.37).rgb;
    vec3 detail = (sampleA * weights.x + sampleB * weights.y + sampleC * weights.z) * 2.0 - 1.0;
    detail = normalize(vec3(detail.x, detail.z, detail.y));
    float roughness = clamp(
      distanceToCamera / max(uHorizonBlendDistance, 0.0001) * uDistanceRoughness,
      0.0,
      1.0
    );
    return normalize(baseNormal + detail * uDetailStrength * (1.0 - roughness * 0.45));
  }
`;

export const WATER_GLINT_GLSL = `
  float waterGlintNoise(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float waterSunGlint(
    vec2 surfaceXZ,
    vec3 normal,
    vec3 viewDir,
    vec3 lightDir,
    float distanceToCamera
  ) {
    float distance01 = clamp(distanceToCamera / max(uHorizonBlendDistance, 0.0001), 0.0, 1.0);
    float noise = waterGlintNoise(surfaceXZ * mix(0.35, 0.035, distance01));
    float threshold = 0.94 - distance01 * 0.16;
    float sparkle = smoothstep(threshold, min(threshold + 0.035, 0.999), noise);
    vec3 halfVector = normalize(viewDir + lightDir);
    float alignment = pow(max(dot(normal, halfVector), 0.0), mix(96.0, 18.0, distance01));
    return sparkle * alignment * uGlintStrength;
  }
`;

export const WATER_FAR_COLOR_GLSL = `
  vec3 waterFarColor(vec3 nearColor, float fresnel, float distanceToCamera) {
    float blend = smoothstep(
      uHorizonBlendDistance * 0.25,
      uHorizonBlendDistance,
      distanceToCamera
    );
    vec3 reflectiveFar = mix(nearColor, uFarColor, 0.55 + fresnel * 0.35);
    return mix(nearColor, reflectiveFar, blend);
  }
`;
