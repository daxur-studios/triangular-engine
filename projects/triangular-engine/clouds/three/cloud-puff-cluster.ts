import {
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  type ShaderMaterial,
  type Vector3,
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
  /** Number of distinct puff shapes to generate and distribute across instances. */
  readonly variantCount?: number;
  readonly seed?: number;
  readonly puffScaleRangeM: readonly [number, number];
  /** Half-extent (metres) of the box instances are jittered within, per axis (used by box domain). */
  readonly regionSizeM?: readonly [number, number, number];
  /** World-space centre the domain is anchored around. Defaults to [0, 0, 0]. */
  readonly originM?: readonly [number, number, number];
  /** Radius (metres) for spherical shell or cylindrical domains. */
  readonly radiusM?: number;
  /** Length / height (metres) for cylindrical domain along its primary axis. */
  readonly lengthM?: number;
  /** Thickness (metres) of the altitude band for sphere/cylinder shells. */
  readonly shellThicknessM?: number;
  /** Icosahedron subdivision level for the base shape before noise displacement. */
  readonly detail?: number;
  /** 'flat' (default) bakes faceted per-face normals for crisp silhouettes; 'smooth' blends them. */
  readonly shading?: CloudPuffShading;
  /** Which {@link ICloudPuffStyle} builds the puff geometry. Defaults to the low-poly blob look. */
  readonly styleId?: string;
  /** Which {@link ICloudPuffDomain} controls puff placement and wind drift. Defaults to the box domain. */
  readonly domainId?: string;
  /** Optional density/moisture weight callback returning 0..1 cloud presence probability. */
  readonly densityAt?: (direction: Vector3) => number;
  readonly material?: ICloudPuffMaterialOptions;
}

export interface ICloudPuffCluster {
  readonly group: Group;
  readonly material: ShaderMaterial;
  setSunDirection(direction: Vector3): void;
  setPointLights(lights: readonly ICloudPuffPointLight[]): void;
  /** Advances wind drift. Interpretation depends on active domain (translation for box, rotation/drift for angular domains). */
  advanceWind(deltaSeconds: number, wind: CloudPuffWindInput, simulationTimeSeconds?: number): void;
  /** Directly sets the absolute simulation time for deterministic positioning / timewarp scrubbing. */
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
  group.name = 'cloud-puff-cluster';

  const meshByVariant = geometries.map((geometry, variant) => {
    const count = instancesPerVariant[variant];
    const mesh = new InstancedMesh(geometry, material, Math.max(count, 1));
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = count;
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

  const transforms = domain.placeInstances(domainContext);
  const matrix = new Matrix4();
  const writeCursor = new Array<number>(variantCount).fill(0);

  for (let i = 0; i < options.instanceCount; i++) {
    const variant = variantIndexPerInstance[i];
    const mesh = meshByVariant[variant];
    const index = writeCursor[variant]++;
    const transform = transforms[i];
    matrix.compose(transform.position, transform.quaternion, transform.scale);
    mesh.setMatrixAt(index, matrix);
  }
  for (const mesh of meshByVariant) mesh.instanceMatrix.needsUpdate = true;

  const windController = domain.createWindController(group, domainContext);

  return {
    group,
    material,
    setSunDirection: (direction) => setCloudPuffSunDirection(material, direction),
    setPointLights: (lights) => setCloudPuffPointLights(material, lights),
    advanceWind: (deltaSeconds, wind, simulationTimeSeconds) =>
      windController.advanceWind(deltaSeconds, wind, simulationTimeSeconds),
    setTime: (simulationTimeSeconds, wind = 0) => {
      if (windController.setTime) {
        windController.setTime(simulationTimeSeconds, wind);
      } else {
        windController.advanceWind(0, wind, simulationTimeSeconds);
      }
    },
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      material.dispose();
      group.clear();
    },
  };
}
