import { Matrix4, Quaternion, Vector3, type Group, type InstancedMesh } from 'three';

import { createCloudRandom01 } from '../../core/cloud-puff-shape';
import {
  advectCylinderAlongWind,
  ICylinderWindFieldParams,
} from '../../core/cloud-wind-field';
import type {
  CloudPuffWindInput,
  ICloudPuffDomain,
  ICloudPuffDomainContext,
  ICloudPuffDomainWindController,
  ICloudPuffTransform,
  ICloudPuffWindOptions,
} from './cloud-puff-domain';

const UP = new Vector3(0, 1, 0);
const DEFAULT_CYLINDER_RADIUS_M = 65;
const DEFAULT_CYLINDER_LENGTH_M = 260;
const DEFAULT_SHELL_THICKNESS_M = 10;

function isWindOptions(wind: CloudPuffWindInput): wind is ICloudPuffWindOptions {
  return typeof wind === 'object' && !Array.isArray(wind);
}

function resolveCylinderWindParams(
  wind: CloudPuffWindInput,
  radiusM: number,
  lengthM: number,
): ICylinderWindFieldParams {
  if (typeof wind === 'number') {
    return {
      circumferentialSpeed: radiusM > 0 ? wind / radiusM : 0.05,
      curlFrequency: 2.0,
      curlStrength: 0.4,
      lengthM,
    };
  }
  if (isWindOptions(wind)) {
    const speed = wind.speed ?? 3.5;
    const circumferentialSpeed =
      wind.angularVelocityRadPerSecond ?? (radiusM > 0 ? speed / radiusM : 0.05);
    const curlStrength = wind.curlTurbulence ?? 0.4;
    return {
      circumferentialSpeed,
      curlFrequency: 2.0,
      curlStrength,
      lengthM,
    };
  }
  const tangentialSpeed = wind[0];
  return {
    circumferentialSpeed: radiusM > 0 ? tangentialSpeed / radiusM : 0.05,
    curlFrequency: 2.0,
    curlStrength: 0.4,
    lengthM,
  };
}

interface ICylinderPuffData {
  readonly initialPhi: number;
  readonly initialZ: number;
  readonly radius: number;
  readonly baseScale: Vector3;
  readonly initialYaw: number;
  readonly lifespanS: number;
  readonly birthOffsetS: number;
}

function smoothstep(min: number, max: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - min) / (max - min)));
  return t * t * (3 - 2 * t);
}

/**
 * Cylinder interior domain: instances are placed on the inner curved surface of a hollow cylinder.
 * Wind circulation runs 16-step RK2 numerical integration around the cylinder curvature
 * (matching the habitat's rotational spin / artificial gravity) with internal vortex eddies
 * that cleanly decelerate near the closed end caps without penetration.
 */
export const CYLINDER_INTERIOR_CLOUD_PUFF_DOMAIN: ICloudPuffDomain = {
  id: 'cylinder-interior',
  label: 'Cylinder interior',
  description:
    'Hollow cylinder inner surface with 16-step RK2 circumferential circulation around the curve.',

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
    const halfLength = (lengthM / 2) * 0.8;

    for (let i = 0; i < context.instanceCount; i++) {
      const phi = random() * Math.PI * 2;
      const cosPhi = Math.cos(phi);
      const sinPhi = Math.sin(phi);

      const r = radiusM + (random() - 0.5) * thicknessM;
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
    const thicknessM = context.shellThicknessM ?? DEFAULT_SHELL_THICKNESS_M;
    const [scaleMin, scaleMax] = context.puffScaleRangeM;
    const origin = new Vector3(...(context.originM ?? [0, 0, 0]));
    const halfLength = (lengthM / 2) * 0.8;
    let accumulatedTimeS = 0;

    group.position.copy(origin);
    group.rotation.set(0, 0, 0);

    const random = createCloudRandom01(context.seed ^ 0x6c8e_93a1);
    const particles: ICylinderPuffData[] = [];
    for (let i = 0; i < context.instanceCount; i++) {
      const phi = random() * Math.PI * 2;
      const z = (random() * 2 - 1) * halfLength;
      const r = radiusM + (random() - 0.5) * thicknessM;
      const puffScale = scaleMin + random() * (scaleMax - scaleMin);
      const lifespan = 35 + random() * 20;
      const birthOffset = random() * lifespan;
      const yaw = random() * Math.PI * 2;

      particles.push({
        initialPhi: phi,
        initialZ: z,
        radius: r,
        baseScale: new Vector3(puffScale, puffScale, puffScale),
        initialYaw: yaw,
        lifespanS: lifespan,
        birthOffsetS: birthOffset,
      });
    }

    const tempMatrix = new Matrix4();
    const tempInward = new Vector3();
    const tempPos = new Vector3();
    const tempScale = new Vector3();
    const tempQAlign = new Quaternion();
    const tempQYaw = new Quaternion();

    function applyWind(timeS: number, wind: CloudPuffWindInput) {
      const windParams = resolveCylinderWindParams(wind, radiusM, lengthM);

      const instMeshes = group.children.filter(
        (c): c is InstancedMesh => (c as InstancedMesh).isInstancedMesh,
      );
      if (instMeshes.length === 0) return;

      const variantCount = instMeshes.length;
      const rand = createCloudRandom01(context.seed ^ 0x9e37_79b9);
      const writeCursors = new Array<number>(variantCount).fill(0);

      for (let i = 0; i < context.instanceCount; i++) {
        const variant = Math.min(variantCount - 1, Math.floor(rand() * variantCount));
        const mesh = instMeshes[variant];
        const cursor = writeCursors[variant]++;
        const p = particles[i];

        const shiftedTime = timeS + p.birthOffsetS;
        const cycle = Math.floor(shiftedTime / p.lifespanS);
        const localT = shiftedTime - cycle * p.lifespanS;
        const cycleStartTime = shiftedTime - localT;
        const lifeFrac = localT / p.lifespanS;

        const growth = smoothstep(0.0, 0.12, lifeFrac) * (1.0 - smoothstep(0.85, 1.0, lifeFrac));
        const scaleMul = Math.max(0.05, growth);

        // 16-step RK2 streamline advection around cylinder curve
        const { phi, z } = advectCylinderAlongWind(
          p.initialPhi,
          p.initialZ,
          cycleStartTime,
          localT,
          p.lifespanS,
          windParams,
        );

        const cosPhi = Math.cos(phi);
        const sinPhi = Math.sin(phi);

        tempPos.set(p.radius * cosPhi, p.radius * sinPhi, z);
        tempInward.set(-cosPhi, -sinPhi, 0).normalize();

        tempQYaw.setFromAxisAngle(UP, p.initialYaw + localT * 0.04);
        tempQAlign.setFromUnitVectors(UP, tempInward);
        const rot = tempQAlign.multiply(tempQYaw);

        tempScale.copy(p.baseScale).multiplyScalar(scaleMul);
        tempMatrix.compose(tempPos, rot, tempScale);
        mesh.setMatrixAt(cursor, tempMatrix);
      }

      for (const mesh of instMeshes) {
        mesh.instanceMatrix.needsUpdate = true;
      }
    }

    return {
      advanceWind(deltaSeconds: number, wind: CloudPuffWindInput, simulationTimeSeconds?: number) {
        if (simulationTimeSeconds !== undefined) {
          accumulatedTimeS = simulationTimeSeconds;
        } else {
          accumulatedTimeS += deltaSeconds;
        }
        applyWind(accumulatedTimeS, wind);
      },
      setTime(simulationTimeSeconds: number, wind: CloudPuffWindInput = 0) {
        accumulatedTimeS = simulationTimeSeconds;
        applyWind(accumulatedTimeS, wind);
      },
    };
  },
};
