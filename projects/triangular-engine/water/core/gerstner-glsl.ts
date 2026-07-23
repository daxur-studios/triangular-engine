import { Vector2, Vector4 } from 'three';
import type { GerstnerWaveDefinition } from './water-surface';
import { resolveGerstnerWaves } from './water-surface';

/**
 * Upper bound on simultaneous waves a material can evaluate. Matches the
 * fixed-size uniform arrays below; keep GLSL and uniform builder in sync.
 */
export const MAX_GERSTNER_WAVES = 8;

/**
 * Uniforms consumed by `GERSTNER_DISPLACE_GLSL` / `GERSTNER_NORMAL_GLSL`.
 * Built from the same `resolveGerstnerWaves` that `GerstnerSurface` uses, so
 * a mesh displaced on the GPU with these uniforms matches
 * `GerstnerSurface.displace()` on the CPU for the same wave list.
 */
export interface GerstnerUniforms {
  uWaveCount: { value: number };
  /** xy = normalized direction, z = angular wavenumber (k), w = amplitude. */
  uWaveDirAmp: { value: Vector4[] };
  /** x = steepness, y = angular frequency (omega). */
  uWaveSteepOmega: { value: Vector2[] };
}

export function createGerstnerUniforms(
  waves: readonly GerstnerWaveDefinition[],
): GerstnerUniforms {
  if (waves.length > MAX_GERSTNER_WAVES) {
    throw new Error(
      `createGerstnerUniforms: ${waves.length} waves exceeds MAX_GERSTNER_WAVES (${MAX_GERSTNER_WAVES}).`,
    );
  }
  const resolved = resolveGerstnerWaves(waves);
  const dirAmp: Vector4[] = [];
  const steepOmega: Vector2[] = [];
  for (let i = 0; i < MAX_GERSTNER_WAVES; i++) {
    const w = resolved[i];
    dirAmp.push(
      w
        ? new Vector4(w.dirX, w.dirZ, w.k, w.amplitude)
        : new Vector4(0, 0, 0, 0),
    );
    steepOmega.push(w ? new Vector2(w.steepness, w.omega) : new Vector2(0, 0));
  }
  return {
    uWaveCount: { value: resolved.length },
    uWaveDirAmp: { value: dirAmp },
    uWaveSteepOmega: { value: steepOmega },
  };
}

/** Updates an existing uniforms object in place from a (possibly new) wave list. */
export function updateGerstnerUniforms(
  uniforms: GerstnerUniforms,
  waves: readonly GerstnerWaveDefinition[],
): void {
  if (waves.length > MAX_GERSTNER_WAVES) {
    throw new Error(
      `updateGerstnerUniforms: ${waves.length} waves exceeds MAX_GERSTNER_WAVES (${MAX_GERSTNER_WAVES}).`,
    );
  }
  const resolved = resolveGerstnerWaves(waves);
  uniforms.uWaveCount.value = resolved.length;
  for (let i = 0; i < MAX_GERSTNER_WAVES; i++) {
    const w = resolved[i];
    if (w) {
      uniforms.uWaveDirAmp.value[i].set(w.dirX, w.dirZ, w.k, w.amplitude);
      uniforms.uWaveSteepOmega.value[i].set(w.steepness, w.omega);
    } else {
      uniforms.uWaveDirAmp.value[i].set(0, 0, 0, 0);
      uniforms.uWaveSteepOmega.value[i].set(0, 0);
    }
  }
}

/** Uniform declarations shared by the displacement and normal GLSL chunks. */
export const GERSTNER_UNIFORMS_GLSL = `
  uniform int uWaveCount;
  uniform vec4 uWaveDirAmp[${MAX_GERSTNER_WAVES}];
  uniform vec2 uWaveSteepOmega[${MAX_GERSTNER_WAVES}];
`;

/**
 * `vec3 gerstnerDisplace(vec2 base, float t)` — world-space position for an
 * undisplaced base (x0, z0), matching `GerstnerSurface.displace()`.
 */
export const GERSTNER_DISPLACE_GLSL = `
  vec3 gerstnerDisplaceAnchored(vec2 base, vec2 phaseBase, float t) {
    vec3 result = vec3(base.x, 0.0, base.y);
    for (int i = 0; i < ${MAX_GERSTNER_WAVES}; i++) {
      if (i >= uWaveCount) break;
      vec2 dir = uWaveDirAmp[i].xy;
      float k = uWaveDirAmp[i].z;
      float amplitude = uWaveDirAmp[i].w;
      float steepness = uWaveSteepOmega[i].x;
      float omega = uWaveSteepOmega[i].y;
      float phase = k * dot(dir, phaseBase) - omega * t;
      float c = cos(phase);
      float s = sin(phase);
      result.x += steepness * amplitude * dir.x * c;
      result.z += steepness * amplitude * dir.y * c;
      result.y += amplitude * s;
    }
    return result;
  }

  vec3 gerstnerDisplace(vec2 base, float t) {
    return gerstnerDisplaceAnchored(base, base, t);
  }
`;

/**
 * `vec3 gerstnerNormal(vec2 base, float t)` — outward surface normal for an
 * undisplaced base (x0, z0), matching `GerstnerSurface`'s private
 * `normalAtBase`. Kept separate from displacement so a caller that only
 * needs position (e.g. building the base grid) can skip the extra cos/sin.
 */
export const GERSTNER_NORMAL_GLSL = `
  vec3 gerstnerNormalAnchored(vec2 phaseBase, float t) {
    float dYdx0 = 0.0;
    float dYdz0 = 0.0;
    float dxdx0 = 1.0;
    float dzdz0 = 1.0;
    float cross0 = 0.0;
    for (int i = 0; i < ${MAX_GERSTNER_WAVES}; i++) {
      if (i >= uWaveCount) break;
      vec2 dir = uWaveDirAmp[i].xy;
      float k = uWaveDirAmp[i].z;
      float amplitude = uWaveDirAmp[i].w;
      float steepness = uWaveSteepOmega[i].x;
      float omega = uWaveSteepOmega[i].y;
      float phase = k * dot(dir, phaseBase) - omega * t;
      float s = sin(phase);
      float c = cos(phase);
      float wa = k * amplitude;
      dYdx0 += dir.x * wa * c;
      dYdz0 += dir.y * wa * c;
      float qwa = steepness * wa;
      dxdx0 -= qwa * dir.x * dir.x * s;
      dzdz0 -= qwa * dir.y * dir.y * s;
      cross0 -= qwa * dir.x * dir.y * s;
    }
    vec3 tangentX0 = vec3(dxdx0, dYdx0, cross0);
    vec3 tangentZ0 = vec3(cross0, dYdz0, dzdz0);
    return normalize(cross(tangentZ0, tangentX0));
  }

  vec3 gerstnerNormal(vec2 base, float t) {
    return gerstnerNormalAnchored(base, t);
  }
`;
