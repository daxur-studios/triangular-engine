/* eslint-disable @typescript-eslint/no-explicit-any */
import { cameraPosition, clamp, color, dot, mix, normalize, positionWorld, pow, sub, vec3 } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';

/**
 * Spike-local water material for plan 080 (W0b): a flat sky-to-deep colour
 * blend driven by a grazing-angle Fresnel term against the up axis. It is the
 * placeholder for the plan's sky Fresnel; the sigma-squared roughness transfer,
 * sun specular and foam are not built yet.
 *
 * The wireframe toggle flips `material.wireframe` on this material, never
 * `<scene>`'s `[wireframe]` input (AGENTS.md rule for spikes).
 */
export function createWaterLodSpikeMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  const up = vec3(0, 1, 0);
  const viewDirection = normalize(sub(cameraPosition, positionWorld));
  // 1 at grazing angles, 0 looking straight down: a cheap stand-in for Schlick's Fresnel with F0 near 0.02.
  const grazing = clamp(sub(1, dot(viewDirection, up)), 0, 1);
  const fresnel = pow(grazing, 5).mul(0.98).add(0.02);
  const deepWater = color('#0b2a3a');
  const skyReflection = color('#9fc4d6');
  material.colorNode = mix(deepWater, skyReflection, fresnel as any);
  material.wireframe = false;
  return material;
}
