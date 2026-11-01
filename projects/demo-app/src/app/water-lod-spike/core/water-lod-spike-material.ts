/* eslint-disable @typescript-eslint/no-explicit-any */
import { cameraPosition, clamp, color, dot, float, max, mix, normalize, positionWorld, pow, reflect, sub, vec3 } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import type { HeightSource } from 'triangular-engine/lod-surface/core';

/** Fixed sun direction (towards the sun), matching the scene's directional light. */
const SUN_DIRECTION = [0.4, 1, 0.3] as const;

/**
 * Spike-local water material for plan 080 (W0b). The surface normal comes from
 * the wave gradient, so the shading follows the 3D wave slopes rather than the
 * flat plane's geometry normal. It is a Lambert term from the fixed sun over
 * the gradient normal, with a grazing-angle Fresnel blend between deep water
 * and sky reflection. This is still a placeholder for the plan's sky Fresnel:
 * the sigma-squared roughness transfer, sun specular and foam are not built yet.
 *
 * The wireframe toggle flips `material.wireframe` on this material, never
 * `<scene>`'s `[wireframe]` input (AGENTS.md rule for spikes).
 *
 * Assumes the plane is untransformed, so `positionWorld` equals the plane-frame
 * position the wave table is sampled at.
 */
export function createWaterLodSpikeMaterial(heights: HeightSource): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  const gradient = heights.gradientNode(positionWorld) as any;
  // Height gradient is (dh/dx, 0, dh/dz); the surface normal is (-dh/dx, 1, -dh/dz).
  const normal = normalize(vec3(gradient.x.negate(), 1, gradient.z.negate()));
  const viewDirection = normalize(sub(cameraPosition, positionWorld));
  // 1 at grazing angles, 0 looking straight down: a cheap stand-in for Schlick's Fresnel with F0 near 0.02.
  const grazing = clamp(sub(1, dot(viewDirection, normal)), 0, 1);
  const fresnel = pow(grazing, 5).mul(0.98).add(0.02);
  const sun = normalize(vec3(...SUN_DIRECTION));
  const lambert = max(dot(normal, sun), 0);
  const light = float(0.35).add(lambert.mul(0.65));
  const deepWater = color('#0b2a3a');
  const skyReflection = color('#9fc4d6');
  // Sun glint: the mirror direction of the view ray, raised to a high power so only the sun's reflection lights up.
  const glint = pow(max(dot(reflect(viewDirection.negate(), normal), sun), 0), 64).mul(0.8);
  material.colorNode = mix(deepWater, skyReflection, fresnel as any).mul(light).add(glint);
  material.wireframe = false;
  return material;
}
