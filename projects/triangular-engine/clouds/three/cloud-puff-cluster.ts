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
import type { CloudPuffShading } from './cloud-puff-geometry';
import {
  createCloudPuffMaterial,
  setCloudPuffPointLights,
  setCloudPuffSunDirection,
  type ICloudPuffMaterialOptions,
  type ICloudPuffPointLight,
} from './cloud-puff-material';
import {
  DEFAULT_CLOUD_PUFF_STYLE_ID,
  getCloudPuffStyleById,
} from './styles/cloud-puff-style-registry';

export interface ICloudPuffClusterOptions {
  readonly instanceCount: number;
  /** Number of distinct puff shapes to generate and distribute across instances. */
  readonly variantCount?: number;
  readonly seed?: number;
  /** Half-extent (metres) of the box instances are jittered within, per axis. */
  readonly regionSizeM: readonly [number, number, number];
  readonly puffScaleRangeM: readonly [number, number];
  /** World-space centre the region (and its wind drift) is anchored around. Defaults to the origin. */
  readonly originM?: readonly [number, number, number];
  /** Icosahedron subdivision level for the base shape before noise displacement. */
  readonly detail?: number;
  /** 'flat' (default) bakes faceted per-face normals for crisp silhouettes; 'smooth' blends them. */
  readonly shading?: CloudPuffShading;
  /** Which {@link ICloudPuffStyle} builds the puff geometry. Defaults to the low-poly blob look. */
  readonly styleId?: string;
  readonly material?: ICloudPuffMaterialOptions;
}

export interface ICloudPuffCluster {
  readonly group: Group;
  readonly material: ShaderMaterial;
  setSunDirection(direction: Vector3): void;
  setPointLights(lights: readonly ICloudPuffPointLight[]): void;
  /** Advances wind drift by translating the cluster; wraps within its region so it never drifts away. */
  advanceWind(deltaSeconds: number, velocityMPerSecond: readonly [number, number, number]): void;
  dispose(): void;
}

const UP = new Vector3(0, 1, 0);

export function buildCloudPuffCluster(options: ICloudPuffClusterOptions): ICloudPuffCluster {
  const seed = options.seed ?? 1;
  const variantCount = Math.max(1, options.variantCount ?? 5);
  const detail = options.detail ?? 1;
  const [regionX, regionY, regionZ] = options.regionSizeM;
  const [scaleMin, scaleMax] = options.puffScaleRangeM;

  const variantParams = createCloudPuffVariantParams(variantCount, seed);
  const style = getCloudPuffStyleById(options.styleId ?? DEFAULT_CLOUD_PUFF_STYLE_ID);
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

  const origin = new Vector3(...(options.originM ?? ([0, 0, 0] as const)));

  const group = new Group();
  group.name = 'cloud-puff-cluster';
  group.position.copy(origin);
  const meshByVariant = geometries.map((geometry, variant) => {
    const count = instancesPerVariant[variant];
    const mesh = new InstancedMesh(geometry, material, Math.max(count, 1));
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = count;
    group.add(mesh);
    return mesh;
  });

  const matrix = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  const writeCursor = new Array<number>(variantCount).fill(0);
  for (let i = 0; i < options.instanceCount; i++) {
    const variant = variantIndexPerInstance[i];
    const mesh = meshByVariant[variant];
    const index = writeCursor[variant]++;
    position.set(
      (random() * 2 - 1) * regionX,
      (random() * 2 - 1) * regionY,
      (random() * 2 - 1) * regionZ,
    );
    quaternion.setFromAxisAngle(UP, random() * Math.PI * 2);
    const puffScale = scaleMin + random() * (scaleMax - scaleMin);
    scale.set(puffScale, puffScale, puffScale);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
  }
  for (const mesh of meshByVariant) mesh.instanceMatrix.needsUpdate = true;

  const windDriftM = new Vector3();

  return {
    group,
    material,
    setSunDirection: (direction) => setCloudPuffSunDirection(material, direction),
    setPointLights: (lights) => setCloudPuffPointLights(material, lights),
    advanceWind(deltaSeconds, velocityMPerSecond) {
      windDriftM.x = wrapAxis(windDriftM.x + velocityMPerSecond[0] * deltaSeconds, regionX);
      windDriftM.y = wrapAxis(windDriftM.y + velocityMPerSecond[1] * deltaSeconds, regionY);
      windDriftM.z = wrapAxis(windDriftM.z + velocityMPerSecond[2] * deltaSeconds, regionZ);
      group.position.set(
        origin.x + windDriftM.x,
        origin.y + windDriftM.y,
        origin.z + windDriftM.z,
      );
    },
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      material.dispose();
      group.clear();
    },
  };
}

/** Keeps a drifting value inside [-halfRange, halfRange) so a wind-driven cluster never wanders off. */
function wrapAxis(value: number, halfRange: number): number {
  if (halfRange <= 0) return 0;
  const range = halfRange * 2;
  let wrapped = (value + halfRange) % range;
  if (wrapped < 0) wrapped += range;
  return wrapped - halfRange;
}
