import { Quaternion, Vector3, type Group } from 'three';

import { createCloudRandom01 } from '../../core/cloud-puff-shape';
import type {
  CloudPuffWindInput,
  ICloudPuffDomain,
  ICloudPuffDomainContext,
  ICloudPuffDomainWindController,
  ICloudPuffTransform,
  ICloudPuffWindOptions,
} from './cloud-puff-domain';

const UP = new Vector3(0, 1, 0);
const DEFAULT_BOX_REGION: readonly [number, number, number] = [110, 22, 110];

function isWindOptions(wind: CloudPuffWindInput): wind is ICloudPuffWindOptions {
  return typeof wind === 'object' && !Array.isArray(wind);
}

/** Keeps a drifting value inside [-halfRange, halfRange) so a wind-driven cluster never wanders off. */
export function wrapAxis(value: number, halfRange: number): number {
  if (halfRange <= 0) return 0;
  const range = halfRange * 2;
  let wrapped = (value + halfRange) % range;
  if (wrapped < 0) wrapped += range;
  return wrapped - halfRange;
}

function resolveBoxVelocity(
  wind: CloudPuffWindInput,
): readonly [number, number, number] {
  if (typeof wind === 'number') {
    return [wind, 0, wind * 0.35];
  }
  if (isWindOptions(wind)) {
    if (wind.velocityMPerSecond) {
      return wind.velocityMPerSecond;
    }
    const speed = wind.speed ?? 0;
    return [speed, 0, speed * 0.35];
  }
  return wind;
}

/**
 * Cartesian box domain: instances are distributed within a rectangular bounding volume.
 * Wind translates the group and wraps each axis within half-extents.
 */
export const BOX_CLOUD_PUFF_DOMAIN: ICloudPuffDomain = {
  id: 'box',
  label: 'Box',
  description: 'Cartesian volume with wrap-around translation wind drift.',

  placeInstances(context: ICloudPuffDomainContext): ICloudPuffTransform[] {
    const random = createCloudRandom01(context.seed ^ 0x517c_c1b7);
    const [regionX, regionY, regionZ] = context.regionSizeM ?? DEFAULT_BOX_REGION;
    const [scaleMin, scaleMax] = context.puffScaleRangeM;

    const transforms: ICloudPuffTransform[] = [];
    for (let i = 0; i < context.instanceCount; i++) {
      const position = new Vector3(
        (random() * 2 - 1) * regionX,
        (random() * 2 - 1) * regionY,
        (random() * 2 - 1) * regionZ,
      );
      const quaternion = new Quaternion().setFromAxisAngle(UP, random() * Math.PI * 2);
      const puffScale = scaleMin + random() * (scaleMax - scaleMin);
      const scale = new Vector3(puffScale, puffScale, puffScale);

      transforms.push({ position, quaternion, scale });
    }
    return transforms;
  },

  createWindController(group: Group, context: ICloudPuffDomainContext): ICloudPuffDomainWindController {
    const [regionX, regionY, regionZ] = context.regionSizeM ?? DEFAULT_BOX_REGION;
    const origin = new Vector3(...(context.originM ?? [0, 0, 0]));
    const windDriftM = new Vector3();

    group.position.copy(origin);

    return {
      advanceWind(deltaSeconds: number, wind: CloudPuffWindInput) {
        const [vx, vy, vz] = resolveBoxVelocity(wind);
        windDriftM.x = wrapAxis(windDriftM.x + vx * deltaSeconds, regionX);
        windDriftM.y = wrapAxis(windDriftM.y + vy * deltaSeconds, regionY);
        windDriftM.z = wrapAxis(windDriftM.z + vz * deltaSeconds, regionZ);
        group.position.set(
          origin.x + windDriftM.x,
          origin.y + windDriftM.y,
          origin.z + windDriftM.z,
        );
      },
    };
  },
};
