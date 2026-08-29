import { Matrix4, Quaternion, Vector3, type Group, type InstancedMesh } from 'three';

import { createCloudRandom01 } from '../../core/cloud-puff-shape';
import {
  advectSphereAlongWind,
  ISphereWindFieldParams,
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
const DEFAULT_SPHERE_RADIUS_M = 75;
const DEFAULT_SHELL_THICKNESS_M = 10;

function isWindOptions(wind: CloudPuffWindInput): wind is ICloudPuffWindOptions {
  return typeof wind === 'object' && !Array.isArray(wind);
}

function resolveSphereWindParams(
  wind: CloudPuffWindInput,
  radiusM: number,
): ISphereWindFieldParams {
  if (typeof wind === 'number') {
    return {
      zonalSpeed: radiusM > 0 ? wind / radiusM : 0.05,
      zonalFrequency: 3.0,
      curlFrequency: 2.5,
      curlStrength: 0.08,
    };
  }
  if (isWindOptions(wind)) {
    const speed = wind.speed ?? 3.5;
    const zonalSpeed = wind.angularVelocityRadPerSecond ?? (radiusM > 0 ? speed / radiusM : 0.05);
    const curlStrength = (wind.curlTurbulence ?? 0.4) * 0.18;
    const zonalFrequency = wind.zonalFrequency ?? (wind.zonalBanding ? 4.0 : 2.5);
    return {
      zonalSpeed,
      zonalFrequency,
      curlFrequency: 2.5,
      curlStrength,
    };
  }
  const speed = Math.hypot(wind[0], wind[2] ?? 0);
  return {
    zonalSpeed: radiusM > 0 ? speed / radiusM : 0.05,
    zonalFrequency: 3.0,
    curlFrequency: 2.5,
    curlStrength: 0.08,
  };
}

interface IPuffParticleData {
  readonly spawnDir: Vector3;
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
 * Samples a unit vector on the sphere with optional rejection sampling against a density/moisture map.
 */
function sampleSphericalDirection(
  random: () => number,
  densityAt?: (dir: Vector3) => number,
  out: Vector3 = new Vector3(),
): Vector3 {
  for (let attempt = 0; attempt < 25; attempt++) {
    const u = random() * 2 - 1; // cos(latitude)
    const theta = random() * Math.PI * 2;
    const rXz = Math.sqrt(Math.max(0, 1 - u * u));
    out.set(rXz * Math.cos(theta), u, rXz * Math.sin(theta)).normalize();

    if (!densityAt) return out;
    const prob = Math.max(0, Math.min(1, densityAt(out)));
    if (random() <= prob) return out;
  }
  return out;
}

/**
 * Spherical shell domain: puffs are advected across a planetary sphere via full 16-step RK2
 * streamline numerical integration over compound velocity fields (zonal jet streams + divergence-free spherical curl noise).
 * Supports optional densityAt rejection-sampling and real-time moisture coupling to Voronoi cell planets.
 */
export const SPHERE_SHELL_CLOUD_PUFF_DOMAIN: ICloudPuffDomain = {
  id: 'sphere-shell',
  label: 'Sphere shell',
  description: 'Spherical planetary shell with 16-step RK2 streamline advection and climate/moisture coupling.',

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
      sampleSphericalDirection(random, context.densityAt, normal);

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
    const thicknessM = context.shellThicknessM ?? DEFAULT_SHELL_THICKNESS_M;
    const [scaleMin, scaleMax] = context.puffScaleRangeM;
    const origin = new Vector3(...(context.originM ?? [0, 0, 0]));
    let accumulatedTimeS = 0;

    group.position.copy(origin);
    group.rotation.set(0, 0, 0);

    const random = createCloudRandom01(context.seed ^ 0x27d4_eb2d);
    const particles: IPuffParticleData[] = [];
    for (let i = 0; i < context.instanceCount; i++) {
      const norm = sampleSphericalDirection(random, context.densityAt);
      const altitude = radiusM + (random() - 0.5) * thicknessM;
      const puffScale = scaleMin + random() * (scaleMax - scaleMin);
      const lifespan = 30 + random() * 20; // 30 - 50s lifespan per puff cycle
      const birthOffset = random() * lifespan;
      const yaw = random() * Math.PI * 2;

      particles.push({
        spawnDir: norm,
        radius: altitude,
        baseScale: new Vector3(puffScale, puffScale, puffScale),
        initialYaw: yaw,
        lifespanS: lifespan,
        birthOffsetS: birthOffset,
      });
    }

    const tempMatrix = new Matrix4();
    const tempDir = new Vector3();
    const tempPos = new Vector3();
    const tempScale = new Vector3();
    const tempQAlign = new Quaternion();
    const tempQYaw = new Quaternion();

    function applyWind(timeS: number, wind: CloudPuffWindInput) {
      const windParams = resolveSphereWindParams(wind, radiusM);

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

        // Periodic lifecycle timing
        const shiftedTime = timeS + p.birthOffsetS;
        const cycle = Math.floor(shiftedTime / p.lifespanS);
        const localT = shiftedTime - cycle * p.lifespanS;
        const cycleStartTime = shiftedTime - localT;
        const lifeFrac = localT / p.lifespanS;

        // Smooth cloud lifecycle (birth -> puff billow -> dissipation)
        const growth = smoothstep(0.0, 0.12, lifeFrac) * (1.0 - smoothstep(0.85, 1.0, lifeFrac));

        // 16-step RK2 streamline advection along compound spherical wind field
        advectSphereAlongWind(p.spawnDir, cycleStartTime, localT, p.lifespanS, windParams, tempDir);

        // Density modulation: if moisture/density callback is provided, scale clouds based on underlying moisture
        let densityMultiplier = 1.0;
        if (context.densityAt) {
          const localMoisture = context.densityAt(tempDir);
          densityMultiplier = 0.2 + 0.8 * Math.max(0, Math.min(1, localMoisture));
        }

        const scaleMul = Math.max(0.04, growth * densityMultiplier);

        tempPos.copy(tempDir).multiplyScalar(p.radius);

        tempQYaw.setFromAxisAngle(UP, p.initialYaw + localT * 0.05);
        tempQAlign.setFromUnitVectors(UP, tempDir);
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
