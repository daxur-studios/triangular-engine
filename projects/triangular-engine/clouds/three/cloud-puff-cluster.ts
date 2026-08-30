import {
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  type ShaderMaterial,
} from 'three';

import { createCloudPuffVariantParams, createCloudRandom01 } from '../core/cloud-puff-shape';
import { type CloudPuffShading } from './cloud-puff-geometry';
import {
  createCloudPuffMaterial,
  setCloudPuffPointLights,
  setCloudPuffSunDirection,
  type ICloudPuffMaterialOptions,
  type ICloudPuffPointLight,
} from './cloud-puff-material';
import type {
  CloudPuffWindInput,
  ICloudPuffDomainContext,
} from './domains/cloud-puff-domain';
import {
  DEFAULT_CLOUD_PUFF_DOMAIN_ID,
  getCloudPuffDomainById,
} from './domains/cloud-puff-domain-registry';
import {
  DEFAULT_CLOUD_PUFF_STYLE_ID,
  getCloudPuffStyleById,
} from './styles/cloud-puff-style-registry';

export interface ICloudPuffClusterOptions {
  readonly instanceCount: number;
  readonly variantCount?: number;
  readonly seed?: number;
  readonly puffScaleRangeM: readonly [number, number];
  readonly regionSizeM?: readonly [number, number, number];
  readonly originM?: readonly [number, number, number];
  readonly radiusM?: number;
  readonly lengthM?: number;
  readonly shellThicknessM?: number;
  readonly detail?: number;
  readonly shading?: CloudPuffShading;
  readonly styleId?: string;
  readonly domainId?: string;
  readonly lodDistanceM?: number;
  readonly densityAt?: (direction: Vector3) => number;
  readonly material?: ICloudPuffMaterialOptions;
}

export interface ICloudPuffCluster {
  readonly group: Group;
  readonly material: ShaderMaterial;
  setSunDirection(direction: Vector3): void;
  setPointLights(lights: readonly ICloudPuffPointLight[]): void;
  updateLod(cameraPosition: Vector3, lodDistanceM?: number): void;
  advanceWind(deltaSeconds: number, wind: CloudPuffWindInput, simulationTimeSeconds?: number): void;
  setTime(simulationTimeSeconds: number, wind?: CloudPuffWindInput): void;
  dispose(): void;
}

export function buildCloudPuffCluster(options: ICloudPuffClusterOptions): ICloudPuffCluster {
  const seed = options.seed ?? 1;
  const variantCount = Math.max(1, options.variantCount ?? 5);
  const detail = options.detail ?? 1;

  const variantParams = createCloudPuffVariantParams(variantCount, seed);
  const style = getCloudPuffStyleById(options.styleId ?? DEFAULT_CLOUD_PUFF_STYLE_ID);
  const domain = getCloudPuffDomainById(options.domainId ?? DEFAULT_CLOUD_PUFF_DOMAIN_ID);

  // Build full 3D detailed shape variants (card stack, low-poly blob, etc.)
  const geometries = style.buildGeometryVariants(variantParams, {
    detail,
    shading: options.shading ?? 'flat',
  });

  const material = createCloudPuffMaterial(options.material);

  const random = createCloudRandom01(seed ^ 0x9e37_79b9);
  const variantIndexPerInstance = new Int32Array(options.instanceCount);
  const instancesPerVariant = new Array<number>(variantCount).fill(0);
  for (let i = 0; i < options.instanceCount; i++) {
    const variant = Math.min(variantCount - 1, Math.floor(random() * variantCount));
    variantIndexPerInstance[i] = variant;
    instancesPerVariant[variant]++;
  }

  const group = new Group();
  group.name = 'cloud-puff-3d-cluster';

  const meshes = geometries.map((geometry, variant) => {
    const count = instancesPerVariant[variant];
    const mesh = new InstancedMesh(geometry, material, Math.max(count, 1));
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = count;
    mesh.name = `cloud-puff-3d-v${variant}`;
    group.add(mesh);
    return mesh;
  });

  const domainContext: ICloudPuffDomainContext = {
    instanceCount: options.instanceCount,
    seed,
    puffScaleRangeM: options.puffScaleRangeM,
    originM: options.originM,
    regionSizeM: options.regionSizeM,
    radiusM: options.radiusM,
    lengthM: options.lengthM,
    shellThicknessM: options.shellThicknessM,
    densityAt: options.densityAt,
  };

  // Map each instance index to its mesh variant and slot
  const instanceSlots: Array<{ variant: number; slot: number }> = new Array(options.instanceCount);
  const writeCursor = new Array<number>(variantCount).fill(0);
  for (let i = 0; i < options.instanceCount; i++) {
    const variant = variantIndexPerInstance[i];
    const slot = writeCursor[variant]++;
    instanceSlots[i] = { variant, slot };
  }

  // Active runtime state per instance
  const currentPositions: Vector3[] = [];
  const currentRotations: Quaternion[] = [];
  const currentScales: Vector3[] = [];
  for (let i = 0; i < options.instanceCount; i++) {
    currentPositions.push(new Vector3(0, 0, 0));
    currentRotations.push(new Quaternion());
    currentScales.push(new Vector3(0, 0, 0));
  }

  const initialTransforms = domain.placeInstances(domainContext);
  const matrix = new Matrix4();
  const zeroMatrix = new Matrix4().makeScale(0, 0, 0);

  for (let i = 0; i < options.instanceCount; i++) {
    const t = initialTransforms[i];
    currentPositions[i].copy(t.position);
    currentRotations[i].copy(t.quaternion);
    currentScales[i].copy(t.scale);

    const { variant, slot } = instanceSlots[i];
    // Start initially culled until camera LOD update
    meshes[variant].setMatrixAt(slot, zeroMatrix);
  }
  for (const m of meshes) m.instanceMatrix.needsUpdate = true;

  const windController = domain.createWindController(group, domainContext);

  let activeLodDistanceM = options.lodDistanceM ?? 80;
  let lastCameraPos = new Vector3(0, 50, 150);

  function applyLod(cameraPosition: Vector3, lodThresholdM: number) {
    lastCameraPos.copy(cameraPosition);
    const thresholdSq = lodThresholdM * lodThresholdM;

    for (let i = 0; i < options.instanceCount; i++) {
      const { variant, slot } = instanceSlots[i];
      const pos = currentPositions[i];
      const distSq = cameraPosition.distanceToSquared(pos);

      if (distSq <= thresholdSq && lodThresholdM > 0) {
        matrix.compose(pos, currentRotations[i], currentScales[i]);
        meshes[variant].setMatrixAt(slot, matrix);
      } else {
        meshes[variant].setMatrixAt(slot, zeroMatrix);
      }
    }

    for (const m of meshes) {
      m.instanceMatrix.needsUpdate = true;
    }
  }

  return {
    group,
    material,
    setSunDirection: (direction) => setCloudPuffSunDirection(material, direction),
    setPointLights: (lights) => setCloudPuffPointLights(material, lights),
    updateLod(cameraPosition: Vector3, lodDistanceM?: number) {
      if (lodDistanceM !== undefined) activeLodDistanceM = lodDistanceM;
      applyLod(cameraPosition, activeLodDistanceM);
    },
    advanceWind(deltaSeconds, wind, simulationTimeSeconds) {
      windController.advanceWind(deltaSeconds, wind, simulationTimeSeconds);

      // Read back dynamic matrices updated by wind controller if any
      for (let i = 0; i < options.instanceCount; i++) {
        const { variant, slot } = instanceSlots[i];
        meshes[variant].getMatrixAt(slot, matrix);
        matrix.decompose(currentPositions[i], currentRotations[i], currentScales[i]);
      }

      applyLod(lastCameraPos, activeLodDistanceM);
    },
    setTime(simulationTimeSeconds, wind = 0) {
      if (windController.setTime) {
        windController.setTime(simulationTimeSeconds, wind);
      } else {
        windController.advanceWind(0, wind, simulationTimeSeconds);
      }

      for (let i = 0; i < options.instanceCount; i++) {
        const { variant, slot } = instanceSlots[i];
        meshes[variant].getMatrixAt(slot, matrix);
        matrix.decompose(currentPositions[i], currentRotations[i], currentScales[i]);
      }

      applyLod(lastCameraPos, activeLodDistanceM);
    },
    dispose() {
      for (const g of geometries) g.dispose();
      material.dispose();
      group.clear();
    },
  };
}
