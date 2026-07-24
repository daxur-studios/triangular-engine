import { Matrix4, Quaternion, Vector3 } from 'three';

import type { ITerrainScatterInstance } from '../terrain/scatter-terrain-instances';
import type { ScatterPlacementRules } from '../core/scatter-species-definition';

export interface ScatterScaleRange {
  readonly min: number;
  readonly max: number;
}

const UP = new Vector3(0, 1, 0);

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * t;
}

/** Deterministic unit vector from two [0,1) seeds via an equal-area sphere mapping. */
function randomUnitVector(seedA: number, seedB: number): Vector3 {
  const z = seedA * 2 - 1;
  const theta = seedB * Math.PI * 2;
  const radius = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(radius * Math.cos(theta), z, radius * Math.sin(theta));
}

/**
 * Resolves one instance's placement data + alignment rule into a render
 * transform. Position is anchor-relative (f32-safe at planetary radii) —
 * callers pass the same anchor they used to place the batch's parent object.
 */
export function computeScatterInstanceMatrix(
  instance: ITerrainScatterInstance,
  rules: ScatterPlacementRules,
  scale: ScatterScaleRange,
  anchorWorldM: readonly [number, number, number],
): Matrix4 {
  const position = new Vector3(
    instance.worldPositionM[0] - anchorWorldM[0],
    instance.worldPositionM[1] - anchorWorldM[1],
    instance.worldPositionM[2] - anchorWorldM[2],
  );

  let quaternion: Quaternion;
  if (rules.alignment === 'random-tumble') {
    const axis = randomUnitVector(instance.rotationSeed01, instance.scaleSeed01);
    quaternion = new Quaternion().setFromAxisAngle(
      axis,
      instance.embedSeed01 * Math.PI * 2,
    );
  } else {
    const referenceUp =
      rules.alignment === 'align-to-surface-up'
        ? instance.surfaceUp
        : instance.normal;
    const align = new Quaternion().setFromUnitVectors(
      UP,
      new Vector3(referenceUp[0], referenceUp[1], referenceUp[2]),
    );
    const yaw = new Quaternion().setFromAxisAngle(
      UP,
      instance.rotationSeed01 * Math.PI * 2,
    );
    quaternion = align.multiply(yaw);
  }

  if (rules.embedDepthM) {
    position.addScaledVector(
      new Vector3(instance.normal[0], instance.normal[1], instance.normal[2]),
      -rules.embedDepthM,
    );
  }

  const scaleValue = lerp(scale.min, scale.max, instance.scaleSeed01);
  return new Matrix4().compose(
    position,
    quaternion,
    new Vector3(scaleValue, scaleValue, scaleValue),
  );
}
