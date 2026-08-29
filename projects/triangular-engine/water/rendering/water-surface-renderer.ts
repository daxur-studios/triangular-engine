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
  PlaneWaterDomain,
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
/** Samples below the frustum centre so a horizon-facing camera still selects visible water. */
const VIEW_RAY_NDC_Y = -0.55;
/** Starts the secondary view grid only after it adds meaningful coverage beyond the camera grid. */
const VIEW_GRID_FADE_START_EXTENTS = 0.45;
const VIEW_GRID_FADE_END_EXTENTS = 0.8;
/** A plane has no far sphere, so keep its two detailed grids overlapped instead of opening a gap. */
const PLANE_VIEW_GRID_MAX_DISTANCE_EXTENTS = 1.5;
/** Bounds tangent-plane distortion when a spherical camera approaches an orbital limb view. */
const SPHERE_VIEW_GRID_MAX_DISTANCE_EXTENTS = 512;
/** Beyond this altitude range geometric waves hand over to the whole-planet far surface. */
const VIEW_DETAIL_FADE_START_RADIUS_RATIO = 0.1;
const VIEW_DETAIL_FADE_END_RADIUS_RATIO = 0.75;
const RAY_INTERSECTION_EPSILON = 1e-5;

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
  private readonly viewLevelMeshes: InstancedMesh[] = [];
  private readonly depthMeshes: InstancedMesh[] = [];
  private readonly levelMaterials: ShaderMaterial[] = [];
  private readonly scratchMatrix = new Matrix4();
  private readonly drawingBufferSize = new Vector2();
  private readonly uLodCameraXZ = { value: new Vector2() };
  private readonly uLodViewXZ = { value: new Vector2() };
  private readonly uLodPeriodZ = { value: 0 };
  private readonly scratchLocalCamera = new Vector2();
  private readonly scratchViewAnchor = new Vector2();
  private readonly scratchViewRay = new Vector3();
  private readonly scratchLowerViewRay = new Vector3();
  private readonly scratchRelative = new Vector3();
  private readonly scratchSurfacePoint = new Vector3();
  private readonly scratchSurfaceNormal = new Vector3();
  private readonly scratchTangentDirection = new Vector3();
  private readonly scratchViewSurfaceNormal = new Vector3(0, 1, 0);
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
  private readonly uViewFieldOpacity = { value: 0 };
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
    for (const mesh of this.viewLevelMeshes) scene.add(mesh);
  }

  update(camera: Camera, elapsedSeconds: number): void {
    this.syncMovingDomain();
    const frame =
      this.domain instanceof CylinderWaterDomain
        ? this.getFixedCylinderFrame(this.domain)
        : this.domain.getLocalFrame(camera.position);
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
      this.domain instanceof CylinderWaterDomain
        ? this.getCylinderCameraXZ(this.domain, frame, camera.position)
        : this.domain.kind === 'plane'
          ? this.scratchLocalCamera.set(
              this.scratchRelative
                .copy(camera.position)
                .sub(frame.origin)
                .dot(frame.tangentU),
              this.scratchRelative.dot(frame.tangentV),
            )
          : this.scratchLocalCamera.set(0, 0);
    const grid = this.getGridOptions();
    const levels = computeWaterLodLevels(localCamera.x, localCamera.y, grid);
    const wrappedLevels =
      this.domain instanceof CylinderWaterDomain
        ? computeWaterLodLevels(
            localCamera.x,
            localCamera.y +
              (localCamera.y >= 0 ? -1 : 1) * this.uLodPeriodZ.value,
            grid,
          )
        : undefined;
    this.uLodCameraXZ.value.copy(localCamera);
    this.updateLevelInstances(this.levelMeshes, levels, wrappedLevels);

    const gridExtent = this.getGridOuterHalfExtent(grid);
    const hasViewAnchor = this.computeViewAnchor(
      camera,
      frame,
      localCamera,
      gridExtent,
      this.scratchViewAnchor,
      this.scratchViewSurfaceNormal,
    );
    const viewDistance = hasViewAnchor
      ? this.scratchViewAnchor.distanceTo(localCamera)
      : 0;
    const viewActivation = hasViewAnchor
      ? smoothstep(
          gridExtent * VIEW_GRID_FADE_START_EXTENTS,
          gridExtent * VIEW_GRID_FADE_END_EXTENTS,
          viewDistance,
        )
      : 0;
    const viewAltitudeFade =
      this.domain instanceof SphereWaterDomain
        ? 1 -
          smoothstep(
            this.domain.radiusM * VIEW_DETAIL_FADE_START_RADIUS_RATIO,
            this.domain.radiusM * VIEW_DETAIL_FADE_END_RADIUS_RATIO,
            Math.max(
              0,
              camera.position.distanceTo(this.domain.center) -
                this.domain.radiusM,
            ),
          )
        : 1;
    this.uViewFieldOpacity.value = viewActivation * viewAltitudeFade;
    if (this.uViewFieldOpacity.value > 0.001) {
      this.uLodViewXZ.value.copy(this.scratchViewAnchor);
      this.updateLevelInstances(
        this.viewLevelMeshes,
        computeWaterLodLevels(
          this.scratchViewAnchor.x,
          this.scratchViewAnchor.y,
          grid,
        ),
      );
    } else {
      for (const mesh of this.viewLevelMeshes) mesh.count = 0;
    }
    this.updatePlanetaryFarSurface(camera, frame.normal, elapsedSeconds);
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
    this.depthPrepass.capture(renderer, scene, camera, this.depthMeshes);
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
      const material = this.createLevelMaterial(
        level,
        grid,
        defines,
        this.uLodCameraXZ,
        this.uNearFieldOpacity,
      );
      const mesh = new InstancedMesh(this.patchGeometry, material, capacity);
      mesh.name = `water-camera-lod-${level}`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.levelMaterials.push(material);
      this.levelMeshes.push(mesh);
      this.depthMeshes.push(mesh);

      if (
        this.domain instanceof PlaneWaterDomain ||
        this.domain instanceof SphereWaterDomain
      ) {
        const viewMaterial = this.createLevelMaterial(
          level,
          grid,
          defines,
          this.uLodViewXZ,
          this.uViewFieldOpacity,
        );
        const viewMesh = new InstancedMesh(
          this.patchGeometry,
          viewMaterial,
          capacity,
        );
        viewMesh.name = `water-view-lod-${level}`;
        viewMesh.count = 0;
        viewMesh.frustumCulled = false;
        this.levelMaterials.push(viewMaterial);
        this.viewLevelMeshes.push(viewMesh);
        this.depthMeshes.push(viewMesh);
      }
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
        uViewFieldOpacity: this.uViewFieldOpacity,
        uViewSurfaceNormal: {
          value: this.scratchViewSurfaceNormal.clone(),
        },
        uViewAngularRadius: {
          value: Math.atan(
            this.getGridOuterHalfExtent(grid) / this.domain.radiusM,
          ),
        },
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
    this.planetaryFarMesh.material.uniforms['uViewSurfaceNormal'].value.copy(
      this.scratchViewSurfaceNormal,
    );
  }

  /** Keeps mutable domain centres aligned with floating-origin scene coordinates. */
  private syncMovingDomain(): void {
    if (this.domain instanceof SphereWaterDomain) {
      this.domainUniforms.uSphereCenter.value.copy(this.domain.center);
      if (this.planetaryFarMesh) {
        this.planetaryFarMesh.position.copy(this.domain.center);
        this.planetaryFarMesh.material.uniforms['uSphereCenter'].value.copy(
          this.domain.center,
        );
      }
    } else if (this.domain instanceof CylinderWaterDomain) {
      this.domainUniforms.uCylinderCenter.value.copy(this.domain.center);
    }
  }

  /** Selects a second LOD anchor from the view ray/frustum while preserving the camera grid. */
  private computeViewAnchor(
    camera: Camera,
    frame: ReturnType<WaterSurfaceDomain['getLocalFrame']>,
    localCamera: Vector2,
    gridExtent: number,
    out: Vector2,
    outSurfaceNormal: Vector3,
  ): boolean {
    if (this.domain instanceof PlaneWaterDomain) {
      camera.getWorldDirection(this.scratchViewRay);
      let found = this.intersectPlaneViewRay(
        camera.position,
        this.scratchViewRay,
        frame,
        out,
      );
      if (!found && camera instanceof PerspectiveCamera) {
        this.lowerFrustumRay(camera, this.scratchLowerViewRay);
        found = this.intersectPlaneViewRay(
          camera.position,
          this.scratchLowerViewRay,
          frame,
          out,
        );
      }
      if (!found) {
        this.scratchTangentDirection
          .copy(this.scratchViewRay)
          .addScaledVector(
            frame.normal,
            -this.scratchViewRay.dot(frame.normal),
          );
        if (
          this.scratchTangentDirection.lengthSq() < RAY_INTERSECTION_EPSILON
        ) {
          return false;
        }
        this.scratchTangentDirection.normalize();
        out.set(
          localCamera.x +
            this.scratchTangentDirection.dot(frame.tangentU) * gridExtent,
          localCamera.y +
            this.scratchTangentDirection.dot(frame.tangentV) * gridExtent,
        );
      }
      this.clampViewAnchorDistance(
        out,
        localCamera,
        gridExtent * PLANE_VIEW_GRID_MAX_DISTANCE_EXTENTS,
      );
      outSurfaceNormal.copy(frame.normal);
      return true;
    }

    if (!(this.domain instanceof SphereWaterDomain)) return false;
    camera.getWorldDirection(this.scratchViewRay);
    let found = this.intersectSphereViewRay(
      camera.position,
      this.scratchViewRay,
      this.domain,
      this.scratchSurfacePoint,
    );
    if (!found && camera instanceof PerspectiveCamera) {
      this.lowerFrustumRay(camera, this.scratchLowerViewRay);
      found = this.intersectSphereViewRay(
        camera.position,
        this.scratchLowerViewRay,
        this.domain,
        this.scratchSurfacePoint,
      );
    }
    if (!found) {
      found = this.sphereHorizonTarget(
        camera.position,
        this.scratchViewRay,
        this.domain,
        this.scratchSurfacePoint,
      );
    }
    if (!found) return false;

    this.scratchSurfaceNormal
      .copy(this.scratchSurfacePoint)
      .sub(this.domain.center)
      .normalize();
    const frameDenominator = this.scratchSurfaceNormal.dot(frame.normal);
    if (frameDenominator <= RAY_INTERSECTION_EPSILON) return false;
    out.set(
      (this.domain.radiusM * this.scratchSurfaceNormal.dot(frame.tangentU)) /
        frameDenominator,
      (this.domain.radiusM * this.scratchSurfaceNormal.dot(frame.tangentV)) /
        frameDenominator,
    );
    this.clampViewAnchorDistance(
      out,
      localCamera,
      Math.min(
        this.domain.radiusM * 4,
        gridExtent * SPHERE_VIEW_GRID_MAX_DISTANCE_EXTENTS,
      ),
    );
    this.domain
      .composeWorldPosition(frame, out.x, out.y, 0, this.scratchSurfacePoint)
      .sub(this.domain.center)
      .normalize();
    outSurfaceNormal.copy(this.scratchSurfacePoint);
    return true;
  }

  private lowerFrustumRay(camera: PerspectiveCamera, out: Vector3): Vector3 {
    return out
      .set(0, VIEW_RAY_NDC_Y, 0.5)
      .unproject(camera)
      .sub(camera.position)
      .normalize();
  }

  private intersectPlaneViewRay(
    origin: Vector3,
    direction: Vector3,
    frame: ReturnType<WaterSurfaceDomain['getLocalFrame']>,
    out: Vector2,
  ): boolean {
    const denominator = direction.dot(frame.normal);
    if (Math.abs(denominator) <= RAY_INTERSECTION_EPSILON) return false;
    const distance =
      this.scratchRelative.copy(frame.origin).sub(origin).dot(frame.normal) /
      denominator;
    if (distance <= RAY_INTERSECTION_EPSILON) return false;
    this.scratchSurfacePoint
      .copy(direction)
      .multiplyScalar(distance)
      .add(origin)
      .sub(frame.origin);
    out.set(
      this.scratchSurfacePoint.dot(frame.tangentU),
      this.scratchSurfacePoint.dot(frame.tangentV),
    );
    return true;
  }

  private intersectSphereViewRay(
    origin: Vector3,
    direction: Vector3,
    domain: SphereWaterDomain,
    out: Vector3,
  ): boolean {
    this.scratchRelative.copy(origin).sub(domain.center);
    const projected = this.scratchRelative.dot(direction);
    const discriminant =
      projected * projected -
      (this.scratchRelative.lengthSq() - domain.radiusM * domain.radiusM);
    if (discriminant < 0) return false;
    const root = Math.sqrt(discriminant);
    let distance = -projected - root;
    if (distance <= RAY_INTERSECTION_EPSILON) distance = -projected + root;
    if (distance <= RAY_INTERSECTION_EPSILON) return false;
    out.copy(direction).multiplyScalar(distance).add(origin);
    return true;
  }

  private sphereHorizonTarget(
    cameraPosition: Vector3,
    viewDirection: Vector3,
    domain: SphereWaterDomain,
    out: Vector3,
  ): boolean {
    this.scratchRelative.copy(cameraPosition).sub(domain.center);
    const distance = this.scratchRelative.length();
    if (distance <= domain.radiusM) return false;
    this.scratchSurfaceNormal.copy(this.scratchRelative).normalize();
    this.scratchTangentDirection
      .copy(viewDirection)
      .addScaledVector(
        this.scratchSurfaceNormal,
        -viewDirection.dot(this.scratchSurfaceNormal),
      );
    if (this.scratchTangentDirection.lengthSq() < RAY_INTERSECTION_EPSILON) {
      return false;
    }
    this.scratchTangentDirection.normalize();
    const horizonAngle = Math.acos(
      Math.max(-1, Math.min(1, domain.radiusM / distance)),
    );
    out
      .copy(this.scratchSurfaceNormal)
      .multiplyScalar(Math.cos(horizonAngle))
      .addScaledVector(this.scratchTangentDirection, Math.sin(horizonAngle))
      .multiplyScalar(domain.radiusM)
      .add(domain.center);
    return true;
  }

  private clampViewAnchorDistance(
    anchor: Vector2,
    origin: Vector2,
    maxDistance: number,
  ): void {
    const dx = anchor.x - origin.x;
    const dy = anchor.y - origin.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= maxDistance || distance === 0) return;
    const scale = maxDistance / distance;
    anchor.set(origin.x + dx * scale, origin.y + dy * scale);
  }

  private updateLevelInstances(
    meshes: readonly InstancedMesh[],
    levels: ReturnType<typeof computeWaterLodLevels>,
    wrappedLevels?: ReturnType<typeof computeWaterLodLevels>,
  ): void {
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      const mesh = meshes[i];
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
    lodAnchorUniform: { value: Vector2 },
    opacityUniform: { value: number },
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
        uLodCameraXZ: lodAnchorUniform,
        uLodPeriodZ: this.uLodPeriodZ,
        uCellSize: { value: patchWorldSize / grid.patchResolution },
        uMorphStart: { value: Math.max(morphEnd - 2 * patchWorldSize, 0) },
        uMorphEnd: { value: morphEnd },
        uInnerCullRadius: { value: innerCullRadius },
        uOuterCullRadius: { value: outerCullRadius },
        uLightDirection: { value: this.lightDirection },
        uNearFieldOpacity: opacityUniform,
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
    for (const mesh of this.viewLevelMeshes) mesh.removeFromParent();
    this.scene = null;
  }

  private disposeGrid(): void {
    for (const mesh of this.levelMeshes) mesh.dispose();
    for (const mesh of this.viewLevelMeshes) mesh.dispose();
    for (const material of this.levelMaterials) material.dispose();
    this.planetaryFarMesh?.geometry.dispose();
    this.planetaryFarMesh?.material.dispose();
    this.planetaryFarNormalMap?.dispose();
    this.planetaryFarMesh = null;
    this.planetaryFarNormalMap = null;
    this.patchGeometry?.dispose();
    this.patchGeometry = null;
    this.levelMeshes.length = 0;
    this.viewLevelMeshes.length = 0;
    this.depthMeshes.length = 0;
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
  uniform vec3 uViewSurfaceNormal;
  uniform float uViewAngularRadius;
  uniform float uViewFieldOpacity;
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
    float viewAngularDistance = acos(clamp(
      dot(sphereNormal, normalize(uViewSurfaceNormal)),
      -1.0,
      1.0
    ));
    float viewHole = smoothstep(
      uViewAngularRadius * ${NEAR_FIELD_HOLE_INNER_RATIO.toFixed(2)},
      uViewAngularRadius,
      viewAngularDistance
    );
    alpha *= mix(1.0, viewHole, uViewFieldOpacity);
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
