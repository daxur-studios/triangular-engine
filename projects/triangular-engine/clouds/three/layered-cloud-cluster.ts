import {
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  type ShaderMaterial,
  type Vector3,
} from 'three';

import { createCloudRandom01 } from '../core/cloud-puff-shape';
import type {
  CloudPuffWindInput,
  ICloudPuffDomainContext,
} from './domains/cloud-puff-domain';
import {
  DEFAULT_CLOUD_PUFF_DOMAIN_ID,
  getCloudPuffDomainById,
} from './domains/cloud-puff-domain-registry';
import {
  buildLayeredCloudGeometry,
  type ILayeredCloudGeometryOptions,
} from './layered-cloud-geometry';
import {
  createLayeredCloudMaterial,
  type ILayeredCloudMaterialOptions,
} from './layered-cloud-material';

export interface ILayeredCloudClusterOptions {
  readonly instanceCount: number;
  readonly layerCount?: number;
  readonly seed?: number;
  readonly scaleRangeM: readonly [number, number];
  readonly radiusM?: number;
  readonly lengthM?: number;
  readonly shellThicknessM?: number;
  readonly regionSizeM?: readonly [number, number, number];
  readonly originM?: readonly [number, number, number];
  readonly domainId?: string;
  readonly densityAt?: (direction: Vector3) => number;
  readonly material?: ILayeredCloudMaterialOptions;
  readonly geometry?: ILayeredCloudGeometryOptions;
}

export interface ILayeredCloudCluster {
  readonly group: Group;
  readonly mesh: InstancedMesh;
  readonly material: ShaderMaterial;
  setSunDirection(direction: Vector3): void;
  setMorphStrength(strength: number): void;
  setMorphSpeed(speed: number): void;
  setOpacity(opacity: number): void;
  setFaceted(faceted: boolean): void;
  advanceWind(deltaSeconds: number, wind: CloudPuffWindInput, simulationTimeSeconds?: number): void;
  setTime(simulationTimeSeconds: number, wind?: CloudPuffWindInput): void;
  dispose(): void;
}

/**
 * Builds an instanced cluster of 3D layered clouds with dynamic GPU-morphed polygonal perimeters.
 */
export function buildLayeredCloudCluster(
  options: ILayeredCloudClusterOptions,
): ILayeredCloudCluster {
  const instanceCount = Math.max(1, options.instanceCount);
  const layerCount = options.layerCount ?? 4;
  const seed = options.seed ?? 1;

  const geometry = buildLayeredCloudGeometry({
    layerCount,
    seed,
    ...options.geometry,
  });

  const material = createLayeredCloudMaterial(options.material);

  const group = new Group();
  group.name = `layered-cloud-cluster-${layerCount}-layers`;

  const mesh = new InstancedMesh(geometry, material, instanceCount);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = instanceCount;
  group.add(mesh);

  const domain = getCloudPuffDomainById(options.domainId ?? DEFAULT_CLOUD_PUFF_DOMAIN_ID);
  const domainContext: ICloudPuffDomainContext = {
    instanceCount,
    seed,
    puffScaleRangeM: options.scaleRangeM,
    originM: options.originM,
    regionSizeM: options.regionSizeM,
    radiusM: options.radiusM,
    lengthM: options.lengthM,
    shellThicknessM: options.shellThicknessM,
    densityAt: options.densityAt,
  };

  const transforms = domain.placeInstances(domainContext);
  const matrix = new Matrix4();

  for (let i = 0; i < instanceCount; i++) {
    const t = transforms[i];
    matrix.compose(t.position, t.quaternion, t.scale);
    mesh.setMatrixAt(i, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;

  const windController = domain.createWindController(group, domainContext);

  return {
    group,
    mesh,
    material,
    setSunDirection(direction: Vector3) {
      material.uniforms['uSunDirection'].value.copy(direction);
    },
    setMorphStrength(strength: number) {
      material.uniforms['uMorphStrength'].value = strength;
    },
    setMorphSpeed(speed: number) {
      material.uniforms['uMorphSpeed'].value = speed;
    },
    setOpacity(opacity: number) {
      material.uniforms['uOpacity'].value = opacity;
      material.depthWrite = opacity > 0.7;
    },
    setFaceted(faceted: boolean) {
      material.uniforms['uFaceted'].value = faceted ? 1.0 : 0.0;
    },
    advanceWind(deltaSeconds: number, wind: CloudPuffWindInput, simulationTimeSeconds?: number) {
      windController.advanceWind(deltaSeconds, wind, simulationTimeSeconds);
      if (simulationTimeSeconds !== undefined) {
        material.uniforms['uTime'].value = simulationTimeSeconds;
      }
    },
    setTime(simulationTimeSeconds: number, wind: CloudPuffWindInput = 0) {
      if (windController.setTime) {
        windController.setTime(simulationTimeSeconds, wind);
      } else {
        windController.advanceWind(0, wind, simulationTimeSeconds);
      }
      material.uniforms['uTime'].value = simulationTimeSeconds;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      group.clear();
    },
  };
}
