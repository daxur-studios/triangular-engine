import { Matrix4, Quaternion, Vector3, type Group, type InstancedMesh } from 'three';

import { createCloudRandom01 } from '../../core/cloud-puff-shape';
import {
  advectBoxAlongWind,
  IBoxWindFieldParams,
  wrapAxisValue,
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
const DEFAULT_BOX_REGION: readonly [number, number, number] = [110, 22, 110];

function isWindOptions(wind: CloudPuffWindInput): wind is ICloudPuffWindOptions {
  return typeof wind === 'object' && !Array.isArray(wind);
}

export function wrapAxis(value: number, halfRange: number): number {
  return wrapAxisValue(value, halfRange);
}

function resolveBoxWindParams(
  wind: CloudPuffWindInput,
  regionSizeM: readonly [number, number, number],
): IBoxWindFieldParams {
  if (typeof wind === 'number') {
    return {
      velocity: [wind, 0, wind * 0.35],
      curlFrequency: 0.02,
      curlStrength: 0.4,
      regionSizeM,
    };
  }
  if (isWindOptions(wind)) {
    const speed = wind.speed ?? 3.5;
    const velocity = wind.velocityMPerSecond ?? [speed, 0, speed * 0.35];
    const curlStrength = wind.curlTurbulence ?? 0.4;
    return {
      velocity,
      curlFrequency: 0.02,
      curlStrength,
      regionSizeM,
    };
  }
  return {
    velocity: wind,
    curlFrequency: 0.02,
    curlStrength: 0.4,
    regionSizeM,
  };
}

interface IBoxPuffData {
  readonly initialPos: Vector3;
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
 * Cartesian box domain: instances are distributed within a rectangular bounding volume.
 * Wind executes 16-step RK2 numerical integration with 3D divergence-free curl turbulence and wrap boundaries.
 */
export const BOX_CLOUD_PUFF_DOMAIN: ICloudPuffDomain = {
  id: 'box',
  label: 'Box',
  description: 'Cartesian volume with 16-step RK2 streamline advection and 3D curl turbulence.',

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
    const regionSize = context.regionSizeM ?? DEFAULT_BOX_REGION;
    const [scaleMin, scaleMax] = context.puffScaleRangeM;
    const origin = new Vector3(...(context.originM ?? [0, 0, 0]));
    let accumulatedTimeS = 0;

    group.position.copy(origin);
    group.rotation.set(0, 0, 0);

    const random = createCloudRandom01(context.seed ^ 0x517c_c1b7);
    const particles: IBoxPuffData[] = [];
    for (let i = 0; i < context.instanceCount; i++) {
      const pos = new Vector3(
        (random() * 2 - 1) * regionSize[0],
        (random() * 2 - 1) * regionSize[1],
        (random() * 2 - 1) * regionSize[2],
      );
      const puffScale = scaleMin + random() * (scaleMax - scaleMin);
      const lifespan = 35 + random() * 20;
      const birthOffset = random() * lifespan;
      const yaw = random() * Math.PI * 2;

      particles.push({
        initialPos: pos,
        baseScale: new Vector3(puffScale, puffScale, puffScale),
        initialYaw: yaw,
        lifespanS: lifespan,
        birthOffsetS: birthOffset,
      });
    }

    const tempMatrix = new Matrix4();
    const tempPos = new Vector3();
    const tempScale = new Vector3();
    const tempQuat = new Quaternion();

    function applyWind(timeS: number, wind: CloudPuffWindInput) {
      const windParams = resolveBoxWindParams(wind, regionSize);

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

        // 16-step RK2 streamline advection
        advectBoxAlongWind(
          p.initialPos,
          cycleStartTime,
          localT,
          p.lifespanS,
          windParams,
          tempPos,
        );

        tempQuat.setFromAxisAngle(UP, p.initialYaw + localT * 0.04);
        tempScale.copy(p.baseScale).multiplyScalar(scaleMul);
        tempMatrix.compose(tempPos, tempQuat, tempScale);
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
