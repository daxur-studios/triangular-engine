import { MathUtils } from 'three';

/** Blend the fused front shoulder into the torso without pinning the knee. */
export function frontLegBlend(y: number, distanceFromAxis: number): number {
  const belowShoulder = 1 - MathUtils.smoothstep(y, -.255, -.178);
  const nearLeg = 1 - MathUtils.smoothstep(distanceFromAxis, .112, .150);
  return belowShoulder * nearLeg;
}
