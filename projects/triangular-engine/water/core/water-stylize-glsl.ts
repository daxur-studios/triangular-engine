export interface WaterStylizeShaderOptions {
  readonly colorSteps?: number;
}

export interface WaterStylizeUniforms {
  uColorSteps: { value: number };
}

export function createWaterStylizeUniforms(
  options: WaterStylizeShaderOptions = {},
): WaterStylizeUniforms {
  return {
    uColorSteps: { value: Math.max(2, Math.round(options.colorSteps ?? 6)) },
  };
}

export function waterPosterizeChannel(value: number, steps: number): number {
  const safeSteps = Math.max(2, Math.round(steps));
  return Math.floor(Math.max(0, Math.min(1, value)) * safeSteps) / safeSteps;
}

export const WATER_STYLIZE_UNIFORMS_GLSL = `
  uniform float uColorSteps;
`;

export const WATER_POSTERIZE_GLSL = `
  vec3 waterPosterize(vec3 color) {
    float steps = max(floor(uColorSteps + 0.5), 2.0);
    return floor(clamp(color, 0.0, 1.0) * steps) / steps;
  }
`;
