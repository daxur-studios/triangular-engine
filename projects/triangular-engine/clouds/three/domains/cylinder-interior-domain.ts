import { Quaternion, Vector3, type Group } from 'three';

import { createCloudRandom01 } from '../../core/cloud-puff-shape';
import { wrapAxis } from './box-domain';
import type {
  CloudPuffWindInput,
  ICloudPuffDomain,
  ICloudPuffDomainContext,
  ICloudPuffDomainWindController,
  ICloudPuffTransform,
  ICloudPuffWindOptions,
} from './cloud-puff-domain';

const UP = new Vector3(0, 1, 0);
const DEFAULT_CYLINDER_RADIUS_M = 90;
const DEFAULT_CYLINDER_LENGTH_M = 260;
const DEFAULT_SHELL_THICKNESS_M = 12;

function isWindOptions(wind: CloudPuffWindInput): wind is ICloudPuffWindOptions {
  return typeof wind === 'object' && !Array.isArray(wind);
}

function resolveCylinderMotion(
  wind: CloudPuffWindInput,
  radiusM: number,
): { axialSpeed: number; angularVelocity: number } {
  if (typeof wind === 'number') {
    return {
      axialSpeed: wind * 0.7,
      angularVelocity: radiusM > 0 ? (wind * 0.35) / radiusM : 0.015,
    };
  }
  if (isWindOptions(wind)) {
    const speed = wind.speed ?? 0;
    const axialSpeed = wind.axialVelocityMPerSecond ?? speed * 0.7;
    const angularVelocity =
      wind.angularVelocityRadPerSecond ?? (radiusM > 0 ? (speed * 0.35) / radiusM : 0.015);
    return { axialSpeed, angularVelocity };
  }
  // Tuple [x, y, z]
  const axialSpeed = wind[2] !== 0 ? wind[2] : wind[0];
  const tangentialSpeed = wind[0];
  return {
    axialSpeed,
    angularVelocity: radiusM > 0 ? tangentialSpeed / radiusM : 0.015,
  };
}

/**
 * Cylinder interior domain: instances are placed on the inner curved surface of a hollow cylinder
 * (e.g. an O'Neill cylinder habitat).
 * Puffs are oriented radially inward toward the central axis.
 * Wind combines axial drift (wrapped along length) and circumferential rotation around the cylinder axis.
 */
export const CYLINDER_INTERIOR_CLOUD_PUFF_DOMAIN: ICloudPuffDomain = {
  id: 'cylinder-interior',
  label: 'Cylinder interior',
  description:
    'Hollow cylinder inner surface with inward-facing puffs, axial drift, and rotation around the axis.',

  placeInstances(context: ICloudPuffDomainContext): ICloudPuffTransform[] {
    const random = createCloudRandom01(context.seed ^ 0x6c8e_93a1);
    const radiusM = context.radiusM ?? DEFAULT_CYLINDER_RADIUS_M;
    const lengthM = context.lengthM ?? DEFAULT_CYLINDER_LENGTH_M;
    const thicknessM = context.shellThicknessM ?? DEFAULT_SHELL_THICKNESS_M;
    const [scaleMin, scaleMax] = context.puffScaleRangeM;

    const transforms: ICloudPuffTransform[] = [];
    const qAlign = new Quaternion();
    const qYaw = new Quaternion();
    const inwardNormal = new Vector3();
    const halfLength = lengthM / 2;

    for (let i = 0; i < context.instanceCount; i++) {
      const phi = random() * Math.PI * 2;
      const cosPhi = Math.cos(phi);
      const sinPhi = Math.sin(phi);

      const r = radiusM - (random() - 0.5) * thicknessM;
      const x = r * cosPhi;
      const y = r * sinPhi;
      const z = (random() * 2 - 1) * halfLength;
      const position = new Vector3(x, y, z);

      // Inward normal towards the central Z axis
      inwardNormal.set(-cosPhi, -sinPhi, 0).normalize();

      qYaw.setFromAxisAngle(UP, random() * Math.PI * 2);
      qAlign.setFromUnitVectors(UP, inwardNormal);
      const quaternion = qAlign.clone().multiply(qYaw);

      const puffScale = scaleMin + random() * (scaleMax - scaleMin);
      const scale = new Vector3(puffScale, puffScale, puffScale);

      transforms.push({ position, quaternion, scale });
    }
    return transforms;
  },

  createWindController(group: Group, context: ICloudPuffDomainContext): ICloudPuffDomainWindController {
    const radiusM = context.radiusM ?? DEFAULT_CYLINDER_RADIUS_M;
    const lengthM = context.lengthM ?? DEFAULT_CYLINDER_LENGTH_M;
    const origin = new Vector3(...(context.originM ?? [0, 0, 0]));
    const halfLength = lengthM / 2;

    let axialDriftM = 0;
    let rotationAngle = 0;

    group.position.copy(origin);
    group.rotation.set(0, 0, 0);

    return {
      advanceWind(deltaSeconds: number, wind: CloudPuffWindInput) {
        const { axialSpeed, angularVelocity } = resolveCylinderMotion(wind, radiusM);
        axialDriftM = wrapAxis(axialDriftM + axialSpeed * deltaSeconds, halfLength);
        rotationAngle = (rotationAngle + angularVelocity * deltaSeconds) % (Math.PI * 2);

        group.position.set(origin.x, origin.y, origin.z + axialDriftM);
        group.rotation.z = rotationAngle;
      },
    };
  },
};
