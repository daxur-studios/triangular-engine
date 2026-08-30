import {
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Vector3,
  type Color,
} from 'three';

import {
  createCloudPuffVariantParams,
} from '../core/cloud-puff-shape';
import {
  evaluatePuffClumpTransformFast,
  type IGpuPuffSimParams,
  type IPuffClumpTransformResult,
} from '../core/cloud-puff-gpu-simulation';
import {
  buildCloudAtmosphere,
  type ICloudAtmosphere,
} from './cloud-atmosphere-layer';
import type { ICloudPuffPointLight } from './cloud-puff-material';
import {
  DEFAULT_CLOUD_PUFF_STYLE_ID,
  getCloudPuffStyleById,
} from './styles/cloud-puff-style-registry';

export interface ICloudPuffLodSystemOptions {
  readonly enableMeshLod?: boolean;
  readonly particleCount?: number;
  readonly clumpSize?: number;
  readonly planetRadius?: number;
  readonly shellRadius?: number;
  readonly puffPixelScale?: number;
  readonly clumpRadius?: number;
  readonly followLag?: number;
  readonly lifespanS?: number;
  readonly zonalSpeed?: number;
  readonly zonalFrequency?: number;
  readonly curlStrength?: number;
  readonly curlFrequency?: number;
  readonly rimStrength?: number;
  readonly puffColor?: Color | string;
  readonly styleId?: string;
  readonly lodDistanceM?: number;
  readonly maxCloseUpMeshes?: number;
  readonly baseMeshScaleM?: number;
}

export interface ICloudPuffLodSystem {
  readonly group: Group;
  readonly atmosphere: ICloudAtmosphere;
  update(timeS: number, cameraPosition: Vector3): void;
  setSunDirection(direction: Vector3): void;
  setPointLights(lights: readonly ICloudPuffPointLight[]): void;
  setStyle(styleId: string): void;
  setLodDistance(distM: number): void;
  setEnableMeshLod(enabled: boolean): void;
  setWindParams(params: {
    zonalSpeed?: number;
    zonalFrequency?: number;
    curlStrength?: number;
    curlFrequency?: number;
  }): void;
  dispose(): void;
}

/**
 * Unified Cloud System with Optional 3D Mesh LOD Toggle:
 * - When enableMeshLod is false (default): Pure GPU particle atmosphere, 0ms CPU overhead, full opacity at all zoom levels.
 * - When enableMeshLod is true: Close-up puffs cross-fade into 1-to-1 3D meshes near the camera.
 */
export function buildCloudPuffLodSystem(
  options: ICloudPuffLodSystemOptions = {},
): ICloudPuffLodSystem {
  let isMeshLodEnabled = options.enableMeshLod ?? false;
  const particleCount = options.particleCount ?? 600;
  const clumpSize = options.clumpSize ?? 4;
  const planetR = options.planetRadius ?? 55;
  const shellR = options.shellRadius ?? planetR * 1.025;
  const maxCloseUpMeshes = options.maxCloseUpMeshes ?? 300;
  const seed = 42;

  const group = new Group();
  group.name = 'unified-cloud-lod-system';

  let activeLodDistanceM = isMeshLodEnabled ? (options.lodDistanceM ?? 65) : 0;

  // 1. GPU Atmosphere Layer (Pure GPU Billboard Puffs)
  const atmosphere = buildCloudAtmosphere({
    particleCount,
    clumpSize,
    planetRadius: planetR,
    puffShellRadius: shellR,
    puffPixelScale: options.puffPixelScale ?? 10.0,
    clumpRadius: options.clumpRadius ?? 0.018,
    followLag: options.followLag ?? 1.5,
    lifespanS: options.lifespanS ?? 22.0,
    zonalSpeed: options.zonalSpeed ?? 0.06,
    zonalFrequency: options.zonalFrequency ?? 3.5,
    curlStrength: options.curlStrength ?? 0.05,
    curlFrequency: options.curlFrequency ?? 2.0,
    rimStrength: options.rimStrength ?? 1.2,
    puffColor: options.puffColor ?? '#f8fafc',
    lodDistanceM: activeLodDistanceM,
  });
  atmosphere.showCirrus(false);
  group.add(atmosphere.group);

  // 2. 3D Mesh Pool (Only instantiated if LOD is enabled)
  let currentStyleId = options.styleId ?? DEFAULT_CLOUD_PUFF_STYLE_ID;
  const variantCount = 5;
  const variantParams = createCloudPuffVariantParams(variantCount, seed);

  let style = getCloudPuffStyleById(currentStyleId);
  let geometries = style.buildGeometryVariants(variantParams, {
    detail: 1,
    shading: 'flat',
  });

  const meshMaterial = new MeshStandardMaterial({
    color: '#f8fafc',
    roughness: 0.9,
    metalness: 0.05,
    flatShading: true,
  });

  const meshesPerVariant = Math.ceil(maxCloseUpMeshes / variantCount);
  const meshGroup = new Group();
  meshGroup.name = 'close-up-3d-meshes';
  group.add(meshGroup);

  let instancedMeshes = geometries.map((geom) => {
    const mesh = new InstancedMesh(geom, meshMaterial, meshesPerVariant);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    meshGroup.add(mesh);
    return mesh;
  });

  let activeZonalSpeed = options.zonalSpeed ?? 0.06;
  let activeZonalFreq = options.zonalFrequency ?? 3.5;
  let activeCurlStr = options.curlStrength ?? 0.05;
  let activeCurlFreq = options.curlFrequency ?? 2.0;
  let activeClumpRadius = options.clumpRadius ?? 0.018;
  let activeFollowLag = options.followLag ?? 1.5;
  let activeLifespan = options.lifespanS ?? 22.0;

  const baseScaleM = options.baseMeshScaleM ?? (planetR / 55) * 2.2;

  const tempResult: IPuffClumpTransformResult = {
    position: new Vector3(),
    quaternion: new Vector3() as any,
    scale: new Vector3(),
    alpha: 1.0,
    visible: true,
  };
  const tempMatrix = new Matrix4();
  const camDir = new Vector3();
  let wasAnyMeshVisible = false;

  function rebuildMeshGeometries(newStyleId: string) {
    currentStyleId = newStyleId;
    style = getCloudPuffStyleById(currentStyleId);
    for (const g of geometries) g.dispose();
    geometries = style.buildGeometryVariants(variantParams, {
      detail: 1,
      shading: 'flat',
    });

    meshGroup.clear();
    instancedMeshes = geometries.map((geom) => {
      const mesh = new InstancedMesh(geom, meshMaterial, meshesPerVariant);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      meshGroup.add(mesh);
      return mesh;
    });
  }

  return {
    group,
    atmosphere,
    update(timeS: number, cameraPosition: Vector3) {
      // 1. Advance GPU Atmosphere (runs on GPU at 120 FPS)
      atmosphere.update(timeS);
      atmosphere.updateCamera(cameraPosition, isMeshLodEnabled ? activeLodDistanceM : 0);

      // 2. If Mesh LOD is toggled off, 0ms CPU work
      if (!isMeshLodEnabled) {
        if (wasAnyMeshVisible) {
          for (let v = 0; v < variantCount; v++) {
            instancedMeshes[v].count = 0;
          }
          wasAnyMeshVisible = false;
        }
        return;
      }

      // 3. Early-out if camera is in orbit far from the cloud shell
      const camDistFromCenter = cameraPosition.length();
      const camAltitude = camDistFromCenter - shellR;

      if (camAltitude > activeLodDistanceM + 10 || activeLodDistanceM <= 0) {
        if (wasAnyMeshVisible) {
          for (let v = 0; v < variantCount; v++) {
            instancedMeshes[v].count = 0;
          }
          wasAnyMeshVisible = false;
        }
        return;
      }

      // 4. Camera is close to the surface: evaluate only the camera-facing hemisphere
      camDir.copy(cameraPosition).normalize();
      const simParams: IGpuPuffSimParams = {
        lifespanS: activeLifespan,
        zonalSpeed: activeZonalSpeed,
        zonalFrequency: activeZonalFreq,
        curlStrength: activeCurlStr,
        curlFrequency: activeCurlFreq,
        shellRadius: shellR,
        clumpRadius: activeClumpRadius,
        followLag: activeFollowLag,
        basePuffScaleM: baseScaleM,
      };

      const lodThresholdSq = activeLodDistanceM * activeLodDistanceM;
      const writeCursors = new Array<number>(variantCount).fill(0);

      for (let p = 0; p < particleCount; p++) {
        for (let c = 0; c < clumpSize; c++) {
          const visible = evaluatePuffClumpTransformFast(p, c, timeS, simParams, tempResult);
          if (!visible) continue;

          if (tempResult.position.dot(camDir) < (shellR * 0.1)) continue;

          const distSq = cameraPosition.distanceToSquared(tempResult.position);
          if (distSq <= lodThresholdSq) {
            const variant = (p + c) % variantCount;
            const slot = writeCursors[variant];
            if (slot < meshesPerVariant) {
              tempMatrix.compose(
                tempResult.position,
                tempResult.quaternion,
                tempResult.scale,
              );
              instancedMeshes[variant].setMatrixAt(slot, tempMatrix);
              writeCursors[variant]++;
            }
          }
        }
      }

      for (let v = 0; v < variantCount; v++) {
        const mesh = instancedMeshes[v];
        const count = writeCursors[v];
        mesh.count = count;
        if (count > 0) {
          mesh.instanceMatrix.needsUpdate = true;
          wasAnyMeshVisible = true;
        }
      }
    },
    setSunDirection(direction: Vector3) {
      atmosphere.setSunDirection(direction);
    },
    setPointLights(lights: readonly ICloudPuffPointLight[]) {
      atmosphere.setPointLights(lights);
    },
    setStyle(styleId: string) {
      if (styleId !== currentStyleId) {
        rebuildMeshGeometries(styleId);
      }
    },
    setLodDistance(distM: number) {
      activeLodDistanceM = distM;
    },
    setEnableMeshLod(enabled: boolean) {
      isMeshLodEnabled = enabled;
      if (!enabled && wasAnyMeshVisible) {
        for (let v = 0; v < variantCount; v++) {
          instancedMeshes[v].count = 0;
        }
        wasAnyMeshVisible = false;
      }
    },
    setWindParams(params) {
      atmosphere.setWindParams(params);
      if (params.zonalSpeed !== undefined) activeZonalSpeed = params.zonalSpeed;
      if (params.zonalFrequency !== undefined) activeZonalFreq = params.zonalFrequency;
      if (params.curlStrength !== undefined) activeCurlStr = params.curlStrength;
      if (params.curlFrequency !== undefined) activeCurlFreq = params.curlFrequency;
    },
    dispose() {
      atmosphere.dispose();
      for (const g of geometries) g.dispose();
      meshMaterial.dispose();
      group.clear();
    },
  };
}
