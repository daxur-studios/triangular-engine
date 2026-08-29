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
const DEFAULT_SPHERE_RADIUS_M = 80;
const DEFAULT_SHELL_THICKNESS_M = 14;

function isWindOptions(wind: CloudPuffWindInput): wind is ICloudPuffWindOptions {
  return typeof wind === 'object' && !Array.isArray(wind);
}

function resolveSphereAngularVelocity(
  wind: CloudPuffWindInput,
  radiusM: number,
): number {
  if (typeof wind === 'number') {
    return radiusM > 0 ? wind / radiusM : 0.02;
  }
  if (isWindOptions(wind)) {
    if (wind.angularVelocityRadPerSecond !== undefined) {
      return wind.angularVelocityRadPerSecond;
    }
    const speed = wind.speed ?? 0;
    return radiusM > 0 ? speed / radiusM : 0.02;
  }
  // Tuple [x, y, z]
  const speed = Math.hypot(wind[0], wind[2] ?? 0);
  return radiusM > 0 ? speed / radiusM : 0.02;
}

/**
 * Spherical shell domain: instances are scattered over a spherical altitude band around a central planet.
 * Each puff is oriented radially outward (puff UP = surface normal).
 * Wind is a continuous rotation of the shell group around the polar axis (wraps seamlessly).
 */
export const SPHERE_SHELL_CLOUD_PUFF_DOMAIN: ICloudPuffDomain = {
  id: 'sphere-shell',
  label: 'Sphere shell',
  description: 'Spherical planetary shell with outward-facing puffs and rotational wind.',

  placeInstances(context: ICloudPuffDomainContext): ICloudPuffTransform[] {
    const random = createCloudRandom01(context.seed ^ 0x27d4_eb2d);
    const radiusM = context.radiusM ?? DEFAULT_SPHERE_RADIUS_M;
    const thicknessM = context.shellThicknessM ?? DEFAULT_SHELL_THICKNESS_M;
    const [scaleMin, scaleMax] = context.puffScaleRangeM;

    const transforms: ICloudPuffTransform[] = [];
    const qAlign = new Quaternion();
    const qYaw = new Quaternion();
    const normal = new Vector3();

    for (let i = 0; i < context.instanceCount; i++) {
      // Uniform point on sphere
      const u = random() * 2 - 1; // cos(latitude) in [-1, 1]
      const theta = random() * Math.PI * 2;
      const rXz = Math.sqrt(Math.max(0, 1 - u * u));
      normal.set(rXz * Math.cos(theta), u, rXz * Math.sin(theta)).normalize();

      const altitude = radiusM + (random() - 0.5) * thicknessM;
      const position = normal.clone().multiplyScalar(altitude);

      qYaw.setFromAxisAngle(UP, random() * Math.PI * 2);
      qAlign.setFromUnitVectors(UP, normal);
      const quaternion = qAlign.clone().multiply(qYaw);

      const puffScale = scaleMin + random() * (scaleMax - scaleMin);
      const scale = new Vector3(puffScale, puffScale, puffScale);

      transforms.push({ position, quaternion, scale });
    }
    return transforms;
  },

  createWindController(group: Group, context: ICloudPuffDomainContext): ICloudPuffDomainWindController {
    const radiusM = context.radiusM ?? DEFAULT_SPHERE_RADIUS_M;
    const origin = new Vector3(...(context.originM ?? [0, 0, 0]));
    let rotationAngle = 0;

    group.position.copy(origin);
    group.rotation.set(0, 0, 0);

    return {
      advanceWind(deltaSeconds: number, wind: CloudPuffWindInput) {
        const omega = resolveSphereAngularVelocity(wind, radiusM);
        rotationAngle = (rotationAngle + omega * deltaSeconds) % (Math.PI * 2);
        group.rotation.y = rotationAngle;
      },
    };
  },
};
