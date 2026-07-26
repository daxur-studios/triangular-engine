import {
  Camera,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  SphereGeometry,
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
  WATER_DOMAIN_CLIP_GLSL,
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
  createWaterFarFieldUniforms,
  WATER_DETAIL_CASCADE_GLSL,
  WATER_FAR_COLOR_GLSL,
  WATER_FAR_FIELD_UNIFORMS_GLSL,
  WATER_GLINT_GLSL,
  type WaterFarFieldUniforms,
} from '../core/water-farfield-glsl';
import {
  createWaterStylizeUniforms,
  WATER_POSTERIZE_GLSL,
  WATER_STYLIZE_UNIFORMS_GLSL,
  type WaterStylizeUniforms,
} from '../core/water-stylize-glsl';
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
const PLANETARY_FAR_SPHERE_WIDTH_SEGMENTS = 96;
const PLANETARY_FAR_SPHERE_HEIGHT_SEGMENTS = 48;
const PLANETARY_FAR_NORMAL_TILING = 48;
const PLANETARY_FAR_SURFACE_OFFSET_CELL_RATIO = 0.025;
const PLANETARY_FAR_SURFACE_MIN_OFFSET_M = 0.05;
const NEAR_FIELD_FADE_START_EXTENTS = 2;
const NEAR_FIELD_FADE_END_EXTENTS = 8;
const NEAR_FIELD_HOLE_INNER_RATIO = 0.65;

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
  private readonly uLodPeriodZ = { value: 0 };
  private readonly domainUniforms: WaterDomainUniforms;
  private readonly surfaceDepthUniforms: WaterSurfaceDepthUniforms;
  private readonly uTime = { value: 0 };
  private gerstnerUniforms: GerstnerUniforms;
  private shadingUniforms: WaterShadingUniforms;
  private farFieldUniforms: WaterFarFieldUniforms;
  private stylizeUniforms: WaterStylizeUniforms;
  private patchGeometry: BufferGeometry | null = null;
  private depthPrepass: WaterDepthPrepass | null = null;
  private ownedDetailNormalMap: Texture | null = null;
  private planetaryFarMesh: Mesh<SphereGeometry, ShaderMaterial> | null = null;
  private planetaryFarNormalMap: Texture | null = null;
  private readonly uNearFieldOpacity = { value: 1 };
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
    this.farFieldUniforms = createWaterFarFieldUniforms(this.preset.farField);
    this.stylizeUniforms = createWaterStylizeUniforms(this.preset.stylize);
    this.configureDomainUniforms();
    this.buildGrid();
  }

  get meshes(): readonly InstancedMesh[] {
    return this.levelMeshes;
  }

  /**
   * Whole-sphere, non-displaced ocean used when a spherical body is viewed
   * beyond the local wave grid.
   */
  get farSurfaceMesh(): Mesh<SphereGeometry, ShaderMaterial> | null {
    return this.planetaryFarMesh;
  }

  addTo(scene: Scene): void {
    if (this.scene === scene) return;
    this.removeFromScene();
    this.scene = scene;
    if (this.planetaryFarMesh) scene.add(this.planetaryFarMesh);
    for (const mesh of this.levelMeshes) scene.add(mesh);
  }

  update(camera: Camera, elapsedSeconds: number): void {
    const frame =
      this.domain instanceof CylinderWaterDomain
        ? this.getFixedCylinderFrame(this.domain)
        : this.domain.getLocalFrame(camera.position);
    this.domainUniforms.uFrameOrigin.value.copy(frame.origin);
    this.domainUniforms.uFrameNormal.value.copy(frame.normal);
    this.domainUniforms.uFrameTangentU.value.copy(frame.tangentU);
    this.domainUniforms.uFrameTangentV.value.copy(frame.tangentV);
    this.updatePlanetaryFarSurface(camera, frame.normal, elapsedSeconds);

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
      this.domain instanceof CylinderWaterDomain
        ? this.getCylinderCameraXZ(this.domain, frame, camera.position)
        : this.domain.kind === 'plane'
          ? new Vector2(
              camera.position.clone().sub(frame.origin).dot(frame.tangentU),
              camera.position.clone().sub(frame.origin).dot(frame.tangentV),
            )
          : new Vector2(0, 0);
    const levels = computeWaterLodLevels(
      localCamera.x,
      localCamera.y,
      this.getGridOptions(),
    );
    const wrappedLevels =
      this.domain instanceof CylinderWaterDomain
        ? computeWaterLodLevels(
            localCamera.x,
            localCamera.y +
              (localCamera.y >= 0 ? -1 : 1) * this.uLodPeriodZ.value,
            this.getGridOptions(),
          )
        : undefined;
    this.uLodCameraXZ.value.copy(localCamera);

    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      const mesh = this.levelMeshes[i];
      const instances = wrappedLevels
        ? this.mergeLodInstances(level.instances, wrappedLevels[i].instances)
        : level.instances;
      mesh.count = instances.length;
      for (let j = 0; j < instances.length; j++) {
        const instance = instances[j];
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
    this.farFieldUniforms = createWaterFarFieldUniforms(preset.farField);
    this.stylizeUniforms = createWaterStylizeUniforms(preset.stylize);
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
        filter: preset.stylize ? 'nearest' : 'linear',
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
      this.uLodPeriodZ.value = 2 * Math.PI * this.domain.radiusM;
      this.domainUniforms.uCylinderHalfLength.value = Number.isFinite(
        this.domain.lengthM,
      )
        ? this.domain.lengthM * 0.5
        : OUTER_CULL_SENTINEL;
    }
  }

  private buildGrid(): void {
    const grid = this.getGridOptions();
    this.patchGeometry = createWaterLodPatchGeometry(grid.patchResolution);
    const capacity =
      grid.coreSizePatches *
      grid.coreSizePatches *
      (this.domain instanceof CylinderWaterDomain ? 2 : 1);
    const defines = {
      ...waterTierDefines(this.preset.tier),
      ...(this.domain.kind === 'sphere' ? { WATER_DOMAIN_SPHERE: 1 } : {}),
      ...(this.domain.kind === 'cylinder' ? { WATER_DOMAIN_CYLINDER: 1 } : {}),
      ...(this.preset.stylize
        ? { WATER_STYLIZE: 1, WATER_DETAIL_NORMALS: 1 }
        : {}),
    };

    for (let level = 0; level <= grid.ringCount; level++) {
      const material = this.createLevelMaterial(level, grid, defines);
      const mesh = new InstancedMesh(this.patchGeometry, material, capacity);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.levelMaterials.push(material);
      this.levelMeshes.push(mesh);
    }
    this.buildPlanetaryFarSurface(grid);
  }

  /**
   * Adds complete spherical coverage beneath the camera-local wave grid.
   * Geometry stays undisplaced; animated normal texture and lighting preserve
   * ocean character when individual waves are below a pixel.
   */
  private buildPlanetaryFarSurface(grid: WaterLodGridOptions): void {
    if (!(this.domain instanceof SphereWaterDomain)) return;

    const surfaceOffset = Math.max(
      PLANETARY_FAR_SURFACE_MIN_OFFSET_M,
      grid.baseCellSize * PLANETARY_FAR_SURFACE_OFFSET_CELL_RATIO,
    );
    const geometry = new SphereGeometry(
      Math.max(
        PLANETARY_FAR_SURFACE_MIN_OFFSET_M,
        this.domain.radiusM - surfaceOffset,
      ),
      PLANETARY_FAR_SPHERE_WIDTH_SEGMENTS,
      PLANETARY_FAR_SPHERE_HEIGHT_SEGMENTS,
    );
    this.planetaryFarNormalMap = createProceduralNormalMapTexture({
      size: 128,
      octaves: 5,
      seed: 17,
    });
    const material = new ShaderMaterial({
      uniforms: {
        uSphereCenter: { value: this.domain.center.clone() },
        uCameraSurfaceNormal: { value: new Vector3(0, 1, 0) },
        uNearAngularRadius: {
          value: Math.atan(
            this.getGridOuterHalfExtent(grid) / this.domain.radiusM,
          ),
        },
        uNearFieldOpacity: this.uNearFieldOpacity,
        uNormalMap: { value: this.planetaryFarNormalMap },
        uTime: this.uTime,
        uLightDirection: { value: this.lightDirection },
        uColorShallow: { value: this.shadingUniforms.uColorShallow.value },
        uColorDeep: { value: this.shadingUniforms.uColorDeep.value },
      },
      vertexShader: PLANETARY_FAR_SURFACE_VERTEX_SHADER,
      fragmentShader: PLANETARY_FAR_SURFACE_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: true,
      side: DoubleSide,
    });
    this.planetaryFarMesh = new Mesh(geometry, material);
    this.planetaryFarMesh.name = 'water-planetary-far-surface';
    this.planetaryFarMesh.position.copy(this.domain.center);
    this.planetaryFarMesh.frustumCulled = false;
  }

  private updatePlanetaryFarSurface(
    camera: Camera,
    cameraSurfaceNormal: Vector3,
    _elapsedSeconds: number,
  ): void {
    if (!(this.domain instanceof SphereWaterDomain) || !this.planetaryFarMesh) {
      this.uNearFieldOpacity.value = 1;
      return;
    }

    const gridExtent = this.getGridOuterHalfExtent(this.getGridOptions());
    const altitude = Math.max(
      0,
      camera.position.distanceTo(this.domain.center) - this.domain.radiusM,
    );
    this.uNearFieldOpacity.value =
      1 -
      smoothstep(
        gridExtent * NEAR_FIELD_FADE_START_EXTENTS,
        gridExtent * NEAR_FIELD_FADE_END_EXTENTS,
        altitude,
      );
    this.planetaryFarMesh.material.uniforms['uCameraSurfaceNormal'].value.copy(
      cameraSurfaceNormal,
    );
  }

  private getGridOuterHalfExtent(grid: WaterLodGridOptions): number {
    return (grid.coreSizePatches / 2) * grid.baseCellSize * 2 ** grid.ringCount;
  }

  private mergeLodInstances(
    primary: readonly { readonly x: number; readonly z: number }[],
    wrapped: readonly { readonly x: number; readonly z: number }[],
  ): readonly { readonly x: number; readonly z: number }[] {
    const merged = [...primary];
    const occupied = new Set(primary.map(({ x, z }) => `${x}:${z}`));
    for (const instance of wrapped) {
      const key = `${instance.x}:${instance.z}`;
      if (!occupied.has(key)) {
        occupied.add(key);
        merged.push(instance);
      }
    }
    return merged;
  }

  /**
   * A finite cylinder is a complete object, unlike the camera-following
   * horizon used by plane/sphere domains. Keep its axial origin and seam
   * stable so orbiting the camera never rotates or translates the mesh.
   */
  private getFixedCylinderFrame(domain: CylinderWaterDomain) {
    const reference =
      Math.abs(domain.axis.y) < 0.9
        ? new Vector3(0, 1, 0)
        : new Vector3(1, 0, 0);
    const radial = new Vector3()
      .crossVectors(domain.axis, reference)
      .normalize();
    return domain.getLocalFrame(
      domain.center.clone().addScaledVector(radial, domain.radiusM),
    );
  }

  /**
   * Tracks the camera across the fixed cylinder parameter space. Clamping to
   * the finite axial bounds keeps an arbitrarily distant outside camera from
   * dragging the LOD grid away from the water object.
   */
  private getCylinderCameraXZ(
    domain: CylinderWaterDomain,
    frame: ReturnType<CylinderWaterDomain['getLocalFrame']>,
    cameraPosition: Vector3,
  ): Vector2 {
    const relative = cameraPosition.clone().sub(domain.center);
    const axial = relative.dot(domain.axis);
    const clampedAxial = Number.isFinite(domain.lengthM)
      ? Math.max(-domain.lengthM * 0.5, Math.min(domain.lengthM * 0.5, axial))
      : axial;
    const radial = relative.addScaledVector(domain.axis, -axial);
    if (radial.lengthSq() === 0) {
      return new Vector2(clampedAxial, 0);
    }
    radial.normalize();
    const frameRadial = frame.normal.clone().negate();
    const angle = Math.atan2(
      radial.dot(frame.tangentV),
      radial.dot(frameRadial),
    );
    return new Vector2(clampedAxial, angle * domain.radiusM);
  }

  /**
   * Ensure the static cylinder grid reaches both ends and the seam opposite
   * its fixed origin. Quality still controls local tessellation; bounds
   * control only how many progressively coarser rings are required.
   */
  private getGridOptions(): WaterLodGridOptions {
    if (!(this.domain instanceof CylinderWaterDomain)) {
      return this.preset.grid;
    }

    const grid = this.preset.grid;
    const requiredHalfExtent = Math.max(
      2 * Math.PI * this.domain.radiusM,
      Number.isFinite(this.domain.lengthM) ? this.domain.lengthM : 0,
    );
    const baseHalfExtent = (grid.coreSizePatches / 2) * grid.baseCellSize;
    const requiredRingCount = Math.max(
      0,
      Math.ceil(Math.log2(requiredHalfExtent / baseHalfExtent)),
    );
    return {
      ...grid,
      ringCount: Math.max(grid.ringCount, requiredRingCount),
    };
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
        ...this.farFieldUniforms,
        ...this.stylizeUniforms,
        ...this.surfaceDepthUniforms,
        ...this.domainUniforms,
        uTime: this.uTime,
        uLodCameraXZ: this.uLodCameraXZ,
        uLodPeriodZ: this.uLodPeriodZ,
        uCellSize: { value: patchWorldSize / grid.patchResolution },
        uMorphStart: { value: Math.max(morphEnd - 2 * patchWorldSize, 0) },
        uMorphEnd: { value: morphEnd },
        uInnerCullRadius: { value: innerCullRadius },
        uOuterCullRadius: { value: outerCullRadius },
        uLightDirection: { value: this.lightDirection },
        uNearFieldOpacity: this.uNearFieldOpacity,
      },
      defines,
      vertexShader: WATER_SURFACE_VERTEX_SHADER,
      fragmentShader: WATER_SURFACE_FRAGMENT_SHADER,
      side: DoubleSide,
      transparent: true,
      // Grazing views can expose several folded wave faces. The nearest face
      // must populate the depth buffer so faces behind it cannot show through.
      depthWrite: true,
      wireframe: this.wireframe,
    });
  }

  private removeFromScene(): void {
    this.planetaryFarMesh?.removeFromParent();
    for (const mesh of this.levelMeshes) mesh.removeFromParent();
    this.scene = null;
  }

  private disposeGrid(): void {
    for (const mesh of this.levelMeshes) mesh.dispose();
    for (const material of this.levelMaterials) material.dispose();
    this.planetaryFarMesh?.geometry.dispose();
    this.planetaryFarMesh?.material.dispose();
    this.planetaryFarNormalMap?.dispose();
    this.planetaryFarMesh = null;
    this.planetaryFarNormalMap = null;
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
  ${WATER_FAR_FIELD_UNIFORMS_GLSL}
  ${WATER_DETAIL_CASCADE_GLSL}
  ${WATER_GLINT_GLSL}
  ${WATER_FAR_COLOR_GLSL}
  ${WATER_STYLIZE_UNIFORMS_GLSL}
  ${WATER_POSTERIZE_GLSL}
  ${WATER_FRESNEL_GLSL}
  ${WATER_DEPTH_UNPACK_GLSL}
  ${WATER_SURFACE_DEPTH_UNIFORMS_GLSL}
  ${WATER_SURFACE_DEPTH_GLSL}
  ${WATER_DEPTH_FADE_GLSL}
  ${WATER_DOMAIN_UNIFORMS_GLSL}
  ${WATER_DOMAIN_COMPOSE_GLSL}
  ${WATER_DOMAIN_COMPOSE_NORMAL_GLSL}
  ${WATER_DOMAIN_CLIP_GLSL}
  uniform vec3 uLightDirection;
  uniform float uInnerCullRadius;
  uniform float uOuterCullRadius;
  uniform float uNearFieldOpacity;
  uniform float uTime;
  uniform vec2 uLodCameraXZ;
  varying vec3 vLocalNormal;
  varying vec3 vWorldPosition;
  varying vec2 vLocalXZ;
  varying vec2 vSurfaceXZ;

  void main() {
    waterLodCull(vLocalXZ, uLodCameraXZ, uInnerCullRadius, uOuterCullRadius);
    waterDomainClip(vWorldPosition, vLocalXZ);
    vec3 localNormal = normalize(vLocalNormal);
    float distanceToCamera = distance(cameraPosition, vWorldPosition);
    #ifdef WATER_DETAIL_NORMALS
      #ifdef WATER_DETAIL_CASCADES
        localNormal = waterDetailCascadeNormal(
          vSurfaceXZ,
          localNormal,
          uTime,
          distanceToCamera
        );
      #else
        localNormal = waterDetailNormal(vSurfaceXZ, localNormal, uTime);
      #endif
    #endif
    vec3 normal = waterComposeWorldNormal(localNormal, vLocalXZ);
    #ifdef WATER_DEPTH_PREPASS
      vec2 screenUV = gl_FragCoord.xy / uResolution;
      float depth = waterSurfaceDepth(screenUV, vWorldPosition);
      float alpha = waterShoreFade(depth);
    #else
      float depth = uAbsorptionDistance;
      float alpha = 1.0;
    #endif
    alpha *= uNearFieldOpacity;
    if (alpha <= 0.001) discard;

    vec3 lightDir = normalize(uLightDirection);
    float diffuse = max(dot(normal, lightDir), 0.0);
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    float fresnel = waterFresnel(normal, viewDir, uFresnelPower);
    vec3 color = waterAbsorb(uColorShallow, uColorDeep, depth);
    color *= diffuse * 0.5 + 0.5;
    color = mix(color, vec3(1.0), fresnel * 0.4);
    #ifdef WATER_GLINT
      float glint = waterSunGlint(
        vSurfaceXZ,
        normal,
        viewDir,
        lightDir,
        distanceToCamera
      );
      color += vec3(glint);
    #endif
    #ifdef WATER_FAR_FIELD
      color = waterFarColor(color, fresnel, distanceToCamera);
    #endif
    #ifdef WATER_STYLIZE
      color = waterPosterize(color);
    #endif
    gl_FragColor = vec4(color, alpha);
    ${WATER_LOGDEPTH_FRAGMENT_GLSL}
  }
`;

export const PLANETARY_FAR_SURFACE_VERTEX_SHADER = `
  ${WATER_LOGDEPTH_PARS_VERTEX_GLSL}
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vSphereNormal;

  void main() {
    vUv = uv;
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    vSphereNormal = normalize(mat3(modelMatrix) * normal);
    vec4 viewPos = viewMatrix * vec4(vWorldPosition, 1.0);
    gl_Position = projectionMatrix * viewPos;
    ${WATER_LOGDEPTH_VERTEX_GLSL}
  }
`;

export const PLANETARY_FAR_SURFACE_FRAGMENT_SHADER = `
  ${WATER_LOGDEPTH_PARS_FRAGMENT_GLSL}
  uniform vec3 uSphereCenter;
  uniform vec3 uCameraSurfaceNormal;
  uniform float uNearAngularRadius;
  uniform float uNearFieldOpacity;
  uniform sampler2D uNormalMap;
  uniform float uTime;
  uniform vec3 uLightDirection;
  uniform vec3 uColorShallow;
  uniform vec3 uColorDeep;
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vSphereNormal;

  void main() {
    vec3 sphereNormal = normalize(vSphereNormal);
    float angularDistance = acos(clamp(
      dot(sphereNormal, normalize(uCameraSurfaceNormal)),
      -1.0,
      1.0
    ));
    float localHole = smoothstep(
      uNearAngularRadius * ${NEAR_FIELD_HOLE_INNER_RATIO.toFixed(2)},
      uNearAngularRadius,
      angularDistance
    );
    float alpha = mix(1.0, localHole, uNearFieldOpacity);
    if (alpha <= 0.001) discard;

    vec2 tiling = vec2(
      ${PLANETARY_FAR_NORMAL_TILING.toFixed(1)},
      ${(PLANETARY_FAR_NORMAL_TILING * 0.5).toFixed(1)}
    );
    vec3 detailA = texture2D(
      uNormalMap,
      vUv * tiling + vec2(uTime * 0.003, uTime * 0.0015)
    ).xyz * 2.0 - 1.0;
    vec3 detailB = texture2D(
      uNormalMap,
      vUv.yx * tiling.yx + vec2(-uTime * 0.0012, uTime * 0.002)
    ).xyz * 2.0 - 1.0;
    vec3 longitudeTangent = cross(vec3(0.0, 1.0, 0.0), sphereNormal);
    if (dot(longitudeTangent, longitudeTangent) < 0.0001) {
      longitudeTangent = vec3(1.0, 0.0, 0.0);
    } else {
      longitudeTangent = normalize(longitudeTangent);
    }
    vec3 latitudeTangent = normalize(cross(sphereNormal, longitudeTangent));
    vec2 detail = (detailA.xy + detailB.xy) * 0.12;
    vec3 normal = normalize(
      sphereNormal
      + longitudeTangent * detail.x
      + latitudeTangent * detail.y
    );

    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 lightDirection = normalize(uLightDirection);
    float diffuse = max(dot(normal, lightDirection), 0.0);
    float fresnel = pow(
      1.0 - max(dot(normal, viewDirection), 0.0),
      3.0
    );
    float glint = pow(
      max(dot(reflect(-lightDirection, normal), viewDirection), 0.0),
      96.0
    );
    vec3 color = mix(uColorDeep, uColorShallow, 0.28 + diffuse * 0.32);
    color = mix(color, vec3(0.62, 0.78, 0.92), fresnel * 0.5);
    color += vec3(glint * 0.45);
    gl_FragColor = vec4(color, alpha);
    ${WATER_LOGDEPTH_FRAGMENT_GLSL}
  }
`;

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
