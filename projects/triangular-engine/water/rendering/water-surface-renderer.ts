import {
  Camera,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
} from 'three';
import {
  createGerstnerUniforms,
  GERSTNER_DISPLACE_GLSL,
  GERSTNER_NORMAL_GLSL,
  GERSTNER_UNIFORMS_GLSL,
  updateGerstnerUniforms,
  type GerstnerUniforms,
} from '../core/gerstner-glsl';
import {
  computeWaterLodBoundaryRadius,
  computeWaterLodLevels,
  type WaterLodGridOptions,
} from '../core/water-lod-grid';
import {
  WATER_LOD_CULL_GLSL,
  WATER_LOD_MORPH_GLSL,
} from '../core/water-lod-glsl';
import { createWaterLodPatchGeometry } from '../core/water-lod-patch-geometry';
import {
  CylinderWaterDomain,
  SphereWaterDomain,
  type WaterSurfaceDomain,
} from '../core/water-domain';
import {
  createWaterDomainUniforms,
  WATER_DOMAIN_COMPOSE_GLSL,
  WATER_DOMAIN_COMPOSE_NORMAL_GLSL,
  WATER_DOMAIN_SURFACE_XZ_GLSL,
  WATER_DOMAIN_UNIFORMS_GLSL,
  type WaterDomainUniforms,
} from '../core/water-domain-glsl';
import {
  createWaterShadingUniforms,
  WATER_DEPTH_FADE_GLSL,
  WATER_DEPTH_UNPACK_GLSL,
  WATER_DETAIL_NORMAL_GLSL,
  WATER_FRESNEL_GLSL,
  WATER_LOGDEPTH_FRAGMENT_GLSL,
  WATER_LOGDEPTH_PARS_FRAGMENT_GLSL,
  WATER_LOGDEPTH_PARS_VERTEX_GLSL,
  WATER_LOGDEPTH_VERTEX_GLSL,
  WATER_SHADING_UNIFORMS_GLSL,
  type WaterShadingUniforms,
} from '../core/water-shading-glsl';
import {
  createWaterSurfaceDepthUniforms,
  updateWaterSurfaceDepthCamera,
  WATER_SURFACE_DEPTH_GLSL,
  WATER_SURFACE_DEPTH_UNIFORMS_GLSL,
  type WaterSurfaceDepthUniforms,
} from '../core/water-surface-depth-glsl';
import { createProceduralNormalMapTexture } from './procedural-normal-map';
import { WaterDepthPrepass } from './water-depth-prepass';
import { waterTierDefines } from './water-quality';
import type { WaterRenderPreset } from './water-render-preset';

const OUTER_CULL_SENTINEL = 1e20;

export interface WaterSurfaceRendererOptions {
  readonly domain: WaterSurfaceDomain;
  readonly preset: WaterRenderPreset;
  readonly lightDirection?: Vector3;
  readonly wireframe?: boolean;
}

/**
 * Framework-free owner of the shared water grid, materials, uniforms and
 * opaque-scene depth capture. Angular components and imperative games use
 * this same class; neither needs to assemble shader chunks.
 */
export class WaterSurfaceRenderer {
  private readonly domain: WaterSurfaceDomain;
  private readonly lightDirection: Vector3;
  private readonly levelMeshes: InstancedMesh[] = [];
  private readonly levelMaterials: ShaderMaterial[] = [];
  private readonly scratchMatrix = new Matrix4();
  private readonly drawingBufferSize = new Vector2();
  private readonly uLodCameraXZ = { value: new Vector2() };
  private readonly domainUniforms: WaterDomainUniforms;
  private readonly surfaceDepthUniforms: WaterSurfaceDepthUniforms;
  private readonly uTime = { value: 0 };
  private gerstnerUniforms: GerstnerUniforms;
  private shadingUniforms: WaterShadingUniforms;
  private patchGeometry: BufferGeometry | null = null;
  private depthPrepass: WaterDepthPrepass | null = null;
  private ownedDetailNormalMap: Texture | null = null;
  private scene: Scene | null = null;
  private preset: WaterRenderPreset;
  private wireframe: boolean;

  constructor(options: WaterSurfaceRendererOptions) {
    this.domain = options.domain;
    this.preset = options.preset;
    this.wireframe = options.wireframe ?? false;
    this.lightDirection =
      options.lightDirection?.clone().normalize() ??
      new Vector3(0.4, 0.8, 0.3).normalize();
    this.domainUniforms = createWaterDomainUniforms();
    this.surfaceDepthUniforms = createWaterSurfaceDepthUniforms();
    this.gerstnerUniforms = createGerstnerUniforms(this.preset.waves.waves);
    this.shadingUniforms = this.createShadingUniforms(this.preset);
    this.configureDomainUniforms();
    this.buildGrid();
  }

  get meshes(): readonly InstancedMesh[] {
    return this.levelMeshes;
  }

  addTo(scene: Scene): void {
    if (this.scene === scene) return;
    this.removeFromScene();
    this.scene = scene;
    for (const mesh of this.levelMeshes) scene.add(mesh);
  }

  update(camera: Camera, elapsedSeconds: number): void {
    const frame = this.domain.getLocalFrame(camera.position);
    this.domainUniforms.uFrameOrigin.value.copy(frame.origin);
    this.domainUniforms.uFrameNormal.value.copy(frame.normal);
    this.domainUniforms.uFrameTangentU.value.copy(frame.tangentU);
    this.domainUniforms.uFrameTangentV.value.copy(frame.tangentV);

    if (this.domain instanceof CylinderWaterDomain) {
      const relative = frame.origin.clone().sub(this.domain.center);
      const radial = relative
        .clone()
        .addScaledVector(this.domain.axis, -relative.dot(this.domain.axis))
        .normalize();
      const reference =
        Math.abs(this.domain.axis.y) < 0.9
          ? new Vector3(0, 1, 0)
          : new Vector3(1, 0, 0);
      const refU = new Vector3()
        .crossVectors(reference, this.domain.axis)
        .normalize();
      const refV = new Vector3().crossVectors(this.domain.axis, refU);
      this.domainUniforms.uFrameOriginAngle.value = Math.atan2(
        radial.dot(refV),
        radial.dot(refU),
      );
    }

    const quantizeHz = this.preset.stylize?.timeQuantizeHz ?? 0;
    this.uTime.value =
      quantizeHz > 0
        ? Math.floor(elapsedSeconds * quantizeHz) / quantizeHz
        : elapsedSeconds;

    const localCamera =
      this.domain.kind === 'plane'
        ? new Vector2(
            camera.position.clone().sub(frame.origin).dot(frame.tangentU),
            camera.position.clone().sub(frame.origin).dot(frame.tangentV),
          )
        : new Vector2(0, 0);
    const levels = computeWaterLodLevels(
      localCamera.x,
      localCamera.y,
      this.preset.grid,
    );
    this.uLodCameraXZ.value.copy(localCamera);

    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      const mesh = this.levelMeshes[i];
      mesh.count = level.instances.length;
      for (let j = 0; j < level.instances.length; j++) {
        const instance = level.instances[j];
        this.scratchMatrix.makeScale(
          level.patchWorldSize,
          1,
          level.patchWorldSize,
        );
        this.scratchMatrix.setPosition(instance.x, 0, instance.z);
        mesh.setMatrixAt(j, this.scratchMatrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  captureDepth(renderer: WebGLRenderer, scene: Scene, camera: Camera): void {
    if (this.preset.tier === 'low' || !(camera instanceof PerspectiveCamera)) {
      return;
    }
    renderer.getDrawingBufferSize(this.drawingBufferSize);
    const width = Math.max(1, this.drawingBufferSize.x);
    const height = Math.max(1, this.drawingBufferSize.y);
    this.depthPrepass ??= new WaterDepthPrepass(width, height);
    this.depthPrepass.setSize(width, height);
    this.depthPrepass.capture(renderer, scene, camera, this.levelMeshes);
    updateWaterSurfaceDepthCamera(this.surfaceDepthUniforms, camera);
    this.shadingUniforms.uSceneDepthTexture.value = this.depthPrepass.texture;
    this.shadingUniforms.uResolution.value.set(width, height);
    this.shadingUniforms.uCameraNear.value = camera.near;
    this.shadingUniforms.uCameraFar.value = camera.far;
  }

  setPreset(preset: WaterRenderPreset): void {
    const attachedScene = this.scene;
    this.removeFromScene();
    this.disposeGrid();
    this.ownedDetailNormalMap?.dispose();
    this.ownedDetailNormalMap = null;
    this.depthPrepass?.dispose();
    this.depthPrepass = null;
    this.preset = preset;
    updateGerstnerUniforms(this.gerstnerUniforms, preset.waves.waves);
    this.shadingUniforms = this.createShadingUniforms(preset);
    this.buildGrid();
    if (attachedScene) this.addTo(attachedScene);
  }

  setWireframe(flag: boolean): void {
    this.wireframe = flag;
    for (const material of this.levelMaterials) material.wireframe = flag;
  }

  dispose(): void {
    this.removeFromScene();
    this.disposeGrid();
    this.ownedDetailNormalMap?.dispose();
    this.ownedDetailNormalMap = null;
    this.depthPrepass?.dispose();
    this.depthPrepass = null;
  }

  private createShadingUniforms(
    preset: WaterRenderPreset,
  ): WaterShadingUniforms {
    const normalMapSize = preset.stylize?.normalMapSize ?? 128;
    const detailNormalMap =
      preset.shading.detailNormalMap ??
      createProceduralNormalMapTexture({
        size: normalMapSize,
        octaves: 5,
        seed: 3,
      });
    if (!preset.shading.detailNormalMap) {
      this.ownedDetailNormalMap = detailNormalMap;
    }
    return createWaterShadingUniforms({
      ...preset.shading,
      detailNormalMap,
    });
  }

  private configureDomainUniforms(): void {
    if (this.domain instanceof SphereWaterDomain) {
      this.domainUniforms.uSphereCenter.value.copy(this.domain.center);
      this.domainUniforms.uSphereRadius.value = this.domain.radiusM;
    } else if (this.domain instanceof CylinderWaterDomain) {
      this.domainUniforms.uCylinderCenter.value.copy(this.domain.center);
      this.domainUniforms.uCylinderAxis.value.copy(this.domain.axis);
      this.domainUniforms.uCylinderRadius.value = this.domain.radiusM;
    }
  }

  private buildGrid(): void {
    const grid = this.preset.grid;
    this.patchGeometry = createWaterLodPatchGeometry(grid.patchResolution);
    const capacity = grid.coreSizePatches * grid.coreSizePatches;
    const defines = {
      ...waterTierDefines(this.preset.tier),
      ...(this.domain.kind === 'sphere' ? { WATER_DOMAIN_SPHERE: 1 } : {}),
      ...(this.domain.kind === 'cylinder' ? { WATER_DOMAIN_CYLINDER: 1 } : {}),
      ...(this.preset.stylize ? { WATER_STYLIZE: 1 } : {}),
    };

    for (let level = 0; level <= grid.ringCount; level++) {
      const material = this.createLevelMaterial(level, grid, defines);
      const mesh = new InstancedMesh(this.patchGeometry, material, capacity);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.levelMaterials.push(material);
      this.levelMeshes.push(mesh);
    }
  }

  private createLevelMaterial(
    level: number,
    grid: WaterLodGridOptions,
    defines: Readonly<Record<string, number>>,
  ): ShaderMaterial {
    const patchWorldSize = grid.baseCellSize * 2 ** level;
    const outerHalfExtent = (grid.coreSizePatches / 2) * patchWorldSize;
    const outermost = level === grid.ringCount;
    const innerCullRadius =
      level > 0 ? computeWaterLodBoundaryRadius(level, grid) : 0;
    const outerCullRadius = outermost
      ? OUTER_CULL_SENTINEL
      : computeWaterLodBoundaryRadius(level + 1, grid);
    const morphEnd = outermost ? outerHalfExtent : outerCullRadius;

    return new ShaderMaterial({
      uniforms: {
        ...this.gerstnerUniforms,
        ...this.shadingUniforms,
        ...this.surfaceDepthUniforms,
        ...this.domainUniforms,
        uTime: this.uTime,
        uLodCameraXZ: this.uLodCameraXZ,
        uCellSize: { value: patchWorldSize / grid.patchResolution },
        uMorphStart: { value: Math.max(morphEnd - 2 * patchWorldSize, 0) },
        uMorphEnd: { value: morphEnd },
        uInnerCullRadius: { value: innerCullRadius },
        uOuterCullRadius: { value: outerCullRadius },
        uLightDirection: { value: this.lightDirection },
      },
      defines,
      vertexShader: WATER_SURFACE_VERTEX_SHADER,
      fragmentShader: WATER_SURFACE_FRAGMENT_SHADER,
      side: DoubleSide,
      transparent: true,
      depthWrite: false,
      wireframe: this.wireframe,
    });
  }

  private removeFromScene(): void {
    for (const mesh of this.levelMeshes) mesh.removeFromParent();
    this.scene = null;
  }

  private disposeGrid(): void {
    for (const mesh of this.levelMeshes) mesh.dispose();
    for (const material of this.levelMaterials) material.dispose();
    this.patchGeometry?.dispose();
    this.patchGeometry = null;
    this.levelMeshes.length = 0;
    this.levelMaterials.length = 0;
  }
}

export const WATER_SURFACE_VERTEX_SHADER = `
  ${WATER_LOGDEPTH_PARS_VERTEX_GLSL}
  ${GERSTNER_UNIFORMS_GLSL}
  ${GERSTNER_DISPLACE_GLSL}
  ${GERSTNER_NORMAL_GLSL}
  ${WATER_LOD_MORPH_GLSL}
  ${WATER_DOMAIN_UNIFORMS_GLSL}
  ${WATER_DOMAIN_COMPOSE_GLSL}
  ${WATER_DOMAIN_SURFACE_XZ_GLSL}
  uniform float uTime;
  uniform vec2 uLodCameraXZ;
  uniform float uCellSize;
  uniform float uMorphStart;
  uniform float uMorphEnd;
  varying vec3 vLocalNormal;
  varying vec3 vWorldPosition;
  varying vec2 vLocalXZ;
  varying vec2 vSurfaceXZ;

  void main() {
    vec2 localXZ = (instanceMatrix * vec4(position, 1.0)).xz;
    vec2 base = waterLodMorph(localXZ, uLodCameraXZ, uCellSize, uMorphStart, uMorphEnd);
    vec2 phaseXZ = waterDomainSurfaceXZ(base);
    #ifdef WATER_GERSTNER
      vec3 localDisplaced = gerstnerDisplaceAnchored(base, phaseXZ, uTime);
      vLocalNormal = gerstnerNormalAnchored(phaseXZ, uTime);
    #else
      vec3 localDisplaced = vec3(base.x, 0.0, base.y);
      vLocalNormal = vec3(0.0, 1.0, 0.0);
    #endif
    vLocalXZ = localDisplaced.xz;
    vSurfaceXZ = waterDomainSurfaceXZ(localDisplaced.xz);
    vWorldPosition = waterComposeWorldPosition(localDisplaced.xz, localDisplaced.y);
    vec4 viewPos = viewMatrix * vec4(vWorldPosition, 1.0);
    gl_Position = projectionMatrix * viewPos;
    ${WATER_LOGDEPTH_VERTEX_GLSL}
  }
`;

export const WATER_SURFACE_FRAGMENT_SHADER = `
  ${WATER_LOGDEPTH_PARS_FRAGMENT_GLSL}
  ${WATER_LOD_CULL_GLSL}
  ${WATER_SHADING_UNIFORMS_GLSL}
  ${WATER_DETAIL_NORMAL_GLSL}
  ${WATER_FRESNEL_GLSL}
  ${WATER_DEPTH_UNPACK_GLSL}
  ${WATER_SURFACE_DEPTH_UNIFORMS_GLSL}
  ${WATER_SURFACE_DEPTH_GLSL}
  ${WATER_DEPTH_FADE_GLSL}
  ${WATER_DOMAIN_UNIFORMS_GLSL}
  ${WATER_DOMAIN_COMPOSE_GLSL}
  ${WATER_DOMAIN_COMPOSE_NORMAL_GLSL}
  uniform vec3 uLightDirection;
  uniform float uInnerCullRadius;
  uniform float uOuterCullRadius;
  uniform float uTime;
  uniform vec2 uLodCameraXZ;
  varying vec3 vLocalNormal;
  varying vec3 vWorldPosition;
  varying vec2 vLocalXZ;
  varying vec2 vSurfaceXZ;

  vec3 waterDomainUp(vec3 worldPosition) {
    #ifdef WATER_DOMAIN_SPHERE
      return normalize(worldPosition - uSphereCenter);
    #elif defined(WATER_DOMAIN_CYLINDER)
      vec3 fromAxis = worldPosition - uCylinderCenter;
      vec3 radial = fromAxis - uCylinderAxis * dot(fromAxis, uCylinderAxis);
      return -normalize(radial);
    #else
      return normalize(uFrameNormal);
    #endif
  }

  void main() {
    waterLodCull(vLocalXZ, uLodCameraXZ, uInnerCullRadius, uOuterCullRadius);
    vec3 localNormal = normalize(vLocalNormal);
    #ifdef WATER_DETAIL_NORMALS
      localNormal = waterDetailNormal(vSurfaceXZ, localNormal, uTime);
    #endif
    vec3 normal = waterComposeWorldNormal(localNormal);
    vec3 domainUp = waterDomainUp(vWorldPosition);

    #ifdef WATER_DEPTH_PREPASS
      vec2 screenUV = gl_FragCoord.xy / uResolution;
      float depth = waterSurfaceDepth(screenUV, vWorldPosition, domainUp);
      float alpha = waterShoreFade(depth);
    #else
      float depth = uAbsorptionDistance;
      float alpha = 1.0;
    #endif

    vec3 lightDir = normalize(uLightDirection);
    float diffuse = max(dot(normal, lightDir), 0.0);
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    float fresnel = waterFresnel(normal, viewDir, uFresnelPower);
    vec3 color = waterAbsorb(uColorShallow, uColorDeep, depth);
    color *= diffuse * 0.5 + 0.5;
    color = mix(color, vec3(1.0), fresnel * 0.4);
    gl_FragColor = vec4(color, alpha);
    ${WATER_LOGDEPTH_FRAGMENT_GLSL}
  }
`;
