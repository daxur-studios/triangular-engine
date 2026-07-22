import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Vector3Tuple,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  CALM_LAKE_PRESET,
  GERSTNER_DISPLACE_GLSL,
  GERSTNER_NORMAL_GLSL,
  GERSTNER_UNIFORMS_GLSL,
  OCEAN_SWELL_PRESET,
  STORM_PRESET,
  SphereWaterDomain,
  WATER_DEPTH_FADE_GLSL,
  WATER_DEPTH_UNPACK_GLSL,
  WATER_DETAIL_NORMAL_GLSL,
  WATER_DOMAIN_COMPOSE_GLSL,
  WATER_DOMAIN_COMPOSE_NORMAL_GLSL,
  WATER_DOMAIN_UNIFORMS_GLSL,
  WATER_FRESNEL_GLSL,
  WATER_LOD_CULL_GLSL,
  WATER_LOD_MORPH_GLSL,
  WATER_LOGDEPTH_FRAGMENT_GLSL,
  WATER_LOGDEPTH_PARS_FRAGMENT_GLSL,
  WATER_LOGDEPTH_PARS_VERTEX_GLSL,
  WATER_LOGDEPTH_VERTEX_GLSL,
  WATER_SHADING_UNIFORMS_GLSL,
  WaterDepthPrepass,
  computeWaterLodBoundaryRadius,
  computeWaterLodLevels,
  createGerstnerUniforms,
  createProceduralNormalMapTexture,
  createWaterDomainUniforms,
  createWaterLodPatchGeometry,
  createWaterShadingUniforms,
  updateGerstnerUniforms,
  type GerstnerUniforms,
  type WaterDomainUniforms,
  type WaterLodGridOptions,
  type WaterShadingUniforms,
  type WaterWavePreset,
} from 'triangular-engine/water';

type PresetKey = 'calmLake' | 'oceanSwell' | 'storm';

const PRESETS: Record<PresetKey, WaterWavePreset> = {
  calmLake: CALM_LAKE_PRESET,
  oceanSwell: OCEAN_SWELL_PRESET,
  storm: STORM_PRESET,
};

const PRESET_LABELS: Record<PresetKey, string> = {
  calmLake: 'Calm lake',
  oceanSwell: 'Ocean swell',
  storm: 'Storm',
};

/** Small "planet" so a full orbit (poles included) fits in a short flythrough. */
const SPHERE_RADIUS_M = 500;
const SPHERE_CENTER = new Vector3(0, 0, 0);

/**
 * A handful of raised bumps on the ground sphere so shore-fade/depth-tint
 * has real variation to react to (islands), rather than water and ground
 * sharing one radius everywhere.
 */
const ISLANDS: ReadonlyArray<{
  readonly direction: Vector3;
  readonly cosAngularRadius: number;
  readonly heightM: number;
}> = [
  { direction: new Vector3(1, 0.4, 0.2).normalize(), cosAngularRadius: Math.cos(0.35), heightM: 14 },
  { direction: new Vector3(-0.6, 0.2, -0.8).normalize(), cosAngularRadius: Math.cos(0.28), heightM: 10 },
  { direction: new Vector3(0.1, -0.3, 0.95).normalize(), cosAngularRadius: Math.cos(0.4), heightM: 16 },
];

/** Ground sits this far below the water radius everywhere except island bumps. */
const OCEAN_FLOOR_DEPTH_M = 6;

/**
 * Same ring-count-as-slider idea as `/water-material-poc`, but capped lower:
 * the local tangent-plane approximation this domain uses (see
 * `SphereWaterDomain`) only stays valid while the grid's outer radius is
 * well under a quarter of the sphere's circumference — at radius 500m that's
 * ~785m, and ring 4 reaches 512m, so this keeps a comfortable margin.
 */
const BASE_GRID_OPTIONS = {
  baseCellSize: 4,
  patchResolution: 8,
  coreSizePatches: 16,
} as const;

const DEFAULT_RING_COUNT = 3;
const MIN_RING_COUNT = 1;
const MAX_RING_COUNT = 4;

const MAX_INSTANCES_PER_LEVEL =
  BASE_GRID_OPTIONS.coreSizePatches * BASE_GRID_OPTIONS.coreSizePatches;

/** Effectively "never" for the outermost level's outer cull test. */
const OUTER_CULL_SENTINEL = 1e9;

/**
 * Vertex positions/normals from `instanceMatrix`/`waterLodMorph`/Gerstner are
 * all in the *local tangent-plane* frame recentred on the camera every frame
 * (see `SphereWaterDomain`) — local camera coordinates are always (0, 0) by
 * construction, so morph/cull compare against `vec2(0.0)` directly rather
 * than a `cameraPosition`-derived uniform. `waterComposeWorldPosition` is the
 * one step that turns that local frame into an actual curved world position;
 * everything upstream of it is identical to `/water-material-poc`'s plane
 * shader.
 */
const VERTEX_SHADER = `
  ${WATER_LOGDEPTH_PARS_VERTEX_GLSL}
  ${GERSTNER_UNIFORMS_GLSL}
  ${GERSTNER_DISPLACE_GLSL}
  ${GERSTNER_NORMAL_GLSL}
  ${WATER_LOD_MORPH_GLSL}
  ${WATER_DOMAIN_UNIFORMS_GLSL}
  ${WATER_DOMAIN_COMPOSE_GLSL}
  uniform float uTime;
  uniform float uCellSize;
  uniform float uMorphStart;
  uniform float uMorphEnd;
  varying vec3 vLocalNormal;
  varying vec3 vWorldPosition;
  varying vec2 vLocalXZ;
  varying float vFragViewZ;

  void main() {
    vec4 instanced = instanceMatrix * vec4(position, 1.0);
    vec4 localPos4 = modelMatrix * instanced;
    vec2 base = waterLodMorph(localPos4.xz, vec2(0.0), uCellSize, uMorphStart, uMorphEnd);

    vec3 localDisplaced = gerstnerDisplace(base, uTime);
    vLocalNormal = gerstnerNormal(base, uTime);
    vLocalXZ = localDisplaced.xz;

    vec3 worldPos = waterComposeWorldPosition(localDisplaced.xz, localDisplaced.y);
    vWorldPosition = worldPos;

    vec4 viewPos = viewMatrix * vec4(worldPos, 1.0);
    vFragViewZ = viewPos.z;
    gl_Position = projectionMatrix * viewPos;
    ${WATER_LOGDEPTH_VERTEX_GLSL}
  }
`;

/**
 * Detail-normal chop and lod-cull both need *local* tangent-plane
 * coordinates, not world position: `WATER_DETAIL_NORMAL_GLSL`'s R=X/G=Z/B=Y
 * decomposition assumes a near-vertical base normal, which only holds in the
 * local frame (world "up" is only near-vertical at the one point directly
 * below the camera on a sphere) — so chop is perturbed on `vLocalNormal` and
 * composed to world *after*, via `waterComposeWorldNormal`, not perturbed on
 * an already-composed world normal.
 */
const FRAGMENT_SHADER = `
  ${WATER_LOGDEPTH_PARS_FRAGMENT_GLSL}
  ${WATER_LOD_CULL_GLSL}
  ${WATER_SHADING_UNIFORMS_GLSL}
  ${WATER_DETAIL_NORMAL_GLSL}
  ${WATER_FRESNEL_GLSL}
  ${WATER_DEPTH_UNPACK_GLSL}
  ${WATER_DEPTH_FADE_GLSL}
  ${WATER_DOMAIN_UNIFORMS_GLSL}
  ${WATER_DOMAIN_COMPOSE_NORMAL_GLSL}
  uniform vec3 uLightDirection;
  uniform float uInnerCullRadius;
  uniform float uOuterCullRadius;
  uniform float uTime;
  uniform float uDetailEnabled;
  uniform float uShoreFadeEnabled;
  varying vec3 vLocalNormal;
  varying vec3 vWorldPosition;
  varying vec2 vLocalXZ;
  varying float vFragViewZ;

  void main() {
    waterLodCull(vLocalXZ, vec2(0.0), uInnerCullRadius, uOuterCullRadius);

    vec3 localBase = normalize(vLocalNormal);
    vec3 localDetailed = waterDetailNormal(vLocalXZ, localBase, uTime);
    vec3 localMixed = normalize(mix(localBase, localDetailed, uDetailEnabled));
    vec3 normal = waterComposeWorldNormal(localMixed);

    vec2 screenUV = gl_FragCoord.xy / uResolution;
    float depth = waterDepth(screenUV, vFragViewZ);
    float shoreFade = mix(1.0, waterShoreFade(depth), uShoreFadeEnabled);

    vec3 lightDir = normalize(uLightDirection);
    float diffuse = max(dot(normal, lightDir), 0.0);
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    float fresnel = waterFresnel(normal, viewDir, uFresnelPower);

    vec3 base = waterAbsorb(uColorShallow, uColorDeep, depth);
    base *= (diffuse * 0.5 + 0.5);
    vec3 color = mix(base, vec3(1.0), fresnel * 0.4);

    gl_FragColor = vec4(color, shoreFade);
    ${WATER_LOGDEPTH_FRAGMENT_GLSL}
  }
`;

/**
 * Phase 1c sphere-domain spike for triangular-engine/water
 * (docs/runbook/002_water_sublibrary.md): the Phase 1a/1b flat CDLOD grid
 * and material, unchanged, curved onto a sphere via `SphereWaterDomain`'s
 * continuously-recentring local tangent frame. Everything except the domain
 * composition step (position + normal) is identical to `/water-material-poc`
 * — see that page for the LOD/material spikes this builds on.
 */
@Component({
  selector: 'app-water-sphere-poc-page',
  imports: [RouterLink, EngineModule],
  templateUrl: './water-sphere-poc-page.component.html',
  styleUrl: './water-sphere-poc-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    EngineService.provide({
      showFPS: true,
      webGLRendererParameters: { logarithmicDepthBuffer: true },
    }),
  ],
  host: { class: 'flex-page' },
})
export class WaterSpherePocPageComponent {
  readonly presetKeys = Object.keys(PRESETS) as PresetKey[];
  readonly presetLabels = PRESET_LABELS;
  readonly activePreset = signal<PresetKey>('oceanSwell');
  readonly detailChop = signal(true);
  readonly shoreFade = signal(true);
  readonly wireframe = signal(false);
  readonly ringCount = signal(DEFAULT_RING_COUNT);
  readonly minRingCount = MIN_RING_COUNT;
  readonly maxRingCount = MAX_RING_COUNT;
  readonly outerExtentMeters = computed(() => {
    const halfCountPatches = BASE_GRID_OPTIONS.coreSizePatches / 2;
    const patchWorldSize =
      BASE_GRID_OPTIONS.baseCellSize * 2 ** this.ringCount();
    return Math.round(halfCountPatches * patchWorldSize);
  });

  readonly sphereRadiusM = SPHERE_RADIUS_M;
  /**
   * Framed standing on the water near the first island rather than orbiting
   * down from far above: camera and target both sit near sea level, and
   * `upVector` is that point's local "up" (the frame's normal), not world
   * +Y — without it, orbitControls' default world-+Y up makes the rig spin
   * around the wrong axis anywhere but the "north pole" of the sphere.
   */
  readonly initialCameraPosition: Vector3Tuple;
  readonly initialTarget: Vector3Tuple;
  readonly initialUpVector: Vector3Tuple;

  private readonly engine = inject(EngineService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly domain = new SphereWaterDomain(SPHERE_RADIUS_M, {
    center: SPHERE_CENTER,
  });
  private readonly gerstnerUniforms: GerstnerUniforms;
  private readonly shadingUniforms: WaterShadingUniforms;
  private readonly domainUniforms: WaterDomainUniforms;
  private readonly uTime = { value: 0 };
  private readonly levelMeshes: InstancedMesh[] = [];
  private readonly levelMaterials: ShaderMaterial[] = [];
  private readonly scratchMatrix = new Matrix4();
  private readonly patchGeometry: BufferGeometry;
  private readonly groundMesh: Mesh;
  private readonly depthPrepass: WaterDepthPrepass;
  private readonly drawingBufferSize = new Vector2();
  private gridOptions: WaterLodGridOptions;

  constructor() {
    const destroyRef = inject(DestroyRef);
    const previousBackground = this.engine.scene.background;
    this.engine.scene.background = new Color('#04121c');

    const startFrame = this.domain.getLocalFrame(
      ISLANDS[0].direction.clone().multiplyScalar(SPHERE_RADIUS_M + 1),
    );
    const startCamera = startFrame.origin
      .clone()
      .addScaledVector(startFrame.normal, 25)
      .addScaledVector(startFrame.tangentU, -40);
    const startTarget = startFrame.origin
      .clone()
      .addScaledVector(startFrame.tangentU, 40);
    this.initialCameraPosition = [startCamera.x, startCamera.y, startCamera.z];
    this.initialTarget = [startTarget.x, startTarget.y, startTarget.z];
    this.initialUpVector = [
      startFrame.normal.x,
      startFrame.normal.y,
      startFrame.normal.z,
    ];

    this.gerstnerUniforms = createGerstnerUniforms(
      PRESETS[this.activePreset()].waves,
    );
    this.shadingUniforms = createWaterShadingUniforms({
      detailNormalMap: createProceduralNormalMapTexture({
        size: 128,
        octaves: 5,
        seed: 3,
      }),
      detailTiling: 6,
      detailStrength: 0.45,
      absorptionDistance: 40,
      shoreFadeDistance: 3,
      colorShallow: '#8fe3ff',
      colorDeep: '#0e4a73',
    });
    this.domainUniforms = createWaterDomainUniforms();
    this.domainUniforms.uSphereCenter.value.copy(SPHERE_CENTER);
    this.domainUniforms.uSphereRadius.value = SPHERE_RADIUS_M;

    this.groundMesh = new Mesh(
      createGroundGeometry(),
      new MeshStandardMaterial({ color: '#8f7a52', roughness: 0.95 }),
    );
    this.engine.scene.add(this.groundMesh);

    this.patchGeometry = createWaterLodPatchGeometry(
      BASE_GRID_OPTIONS.patchResolution,
    );
    this.gridOptions = { ...BASE_GRID_OPTIONS, ringCount: this.ringCount() };
    this.buildGrid(this.gridOptions);

    this.depthPrepass = new WaterDepthPrepass(
      this.engine.width,
      this.engine.height,
    );

    destroyRef.onDestroy(() => {
      this.engine.scene.background = previousBackground;
      this.groundMesh.removeFromParent();
      this.groundMesh.geometry.dispose();
      (this.groundMesh.material as MeshStandardMaterial).dispose();
      for (const mesh of this.levelMeshes) {
        mesh.removeFromParent();
        mesh.dispose();
      }
      for (const material of this.levelMaterials) {
        material.dispose();
      }
      this.patchGeometry.dispose();
      this.shadingUniforms.uDetailNormalMap.value?.dispose();
      this.depthPrepass.dispose();
    });

    this.engine.tick$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((deltaTime) => this.tick(deltaTime));
    this.engine.postTick$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe(() => this.captureDepth());
  }

  selectPreset(key: PresetKey): void {
    if (key === this.activePreset()) return;
    this.activePreset.set(key);
    updateGerstnerUniforms(this.gerstnerUniforms, PRESETS[key].waves);
  }

  toggleDetailChop(): void {
    this.detailChop.update((v) => !v);
    for (const material of this.levelMaterials) {
      material.uniforms['uDetailEnabled'].value = this.detailChop() ? 1 : 0;
    }
  }

  toggleShoreFade(): void {
    this.shoreFade.update((v) => !v);
    for (const material of this.levelMaterials) {
      material.uniforms['uShoreFadeEnabled'].value = this.shoreFade() ? 1 : 0;
    }
  }

  toggleWireframe(): void {
    this.wireframe.update((v) => !v);
    for (const material of this.levelMaterials) {
      material.wireframe = this.wireframe();
    }
    (this.groundMesh.material as MeshStandardMaterial).wireframe =
      this.wireframe();
  }

  /** Rebuilds the LOD grid at a new ring count — see the plane demo's identical method. */
  setRingCount(value: number | string): void {
    const clamped = Math.min(
      MAX_RING_COUNT,
      Math.max(MIN_RING_COUNT, Math.round(Number(value))),
    );
    if (clamped === this.ringCount()) return;
    this.ringCount.set(clamped);
    this.disposeGrid();
    this.gridOptions = { ...BASE_GRID_OPTIONS, ringCount: clamped };
    this.buildGrid(this.gridOptions);
  }

  private buildGrid(gridOptions: WaterLodGridOptions): void {
    const halfCountPatches = gridOptions.coreSizePatches / 2;

    for (let level = 0; level <= gridOptions.ringCount; level++) {
      const patchWorldSize = gridOptions.baseCellSize * 2 ** level;
      const outerHalfExtent = halfCountPatches * patchWorldSize;
      const isOutermost = level === gridOptions.ringCount;

      const innerCullRadius =
        level > 0 ? computeWaterLodBoundaryRadius(level, gridOptions) : 0;
      const outerCullRadius = isOutermost
        ? OUTER_CULL_SENTINEL
        : computeWaterLodBoundaryRadius(level + 1, gridOptions);
      const morphEnd = isOutermost ? outerHalfExtent : outerCullRadius;
      const morphStart = Math.max(morphEnd - 2 * patchWorldSize, 0);

      const material = new ShaderMaterial({
        uniforms: {
          ...this.gerstnerUniforms,
          ...this.shadingUniforms,
          ...this.domainUniforms,
          uTime: this.uTime,
          uCellSize: { value: patchWorldSize / gridOptions.patchResolution },
          uMorphStart: { value: morphStart },
          uMorphEnd: { value: morphEnd },
          uInnerCullRadius: { value: innerCullRadius },
          uOuterCullRadius: { value: outerCullRadius },
          uLightDirection: { value: new Vector3(0.4, 0.8, 0.3).normalize() },
          uDetailEnabled: { value: this.detailChop() ? 1 : 0 },
          uShoreFadeEnabled: { value: this.shoreFade() ? 1 : 0 },
        },
        defines: { WATER_DOMAIN_SPHERE: '' },
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        side: DoubleSide,
        transparent: true,
        depthWrite: false,
        wireframe: this.wireframe(),
      });
      this.levelMaterials.push(material);

      const mesh = new InstancedMesh(
        this.patchGeometry,
        material,
        MAX_INSTANCES_PER_LEVEL,
      );
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.engine.scene.add(mesh);
      this.levelMeshes.push(mesh);
    }
  }

  private disposeGrid(): void {
    for (const mesh of this.levelMeshes) {
      mesh.removeFromParent();
      mesh.dispose();
    }
    for (const material of this.levelMaterials) {
      material.dispose();
    }
    this.levelMeshes.length = 0;
    this.levelMaterials.length = 0;
  }

  private tick(deltaTime: number): void {
    this.uTime.value = this.engine.clock.getElapsedTime();

    const camera = this.engine.camera$.value;
    const frame = this.domain.getLocalFrame(camera.position);
    this.domainUniforms.uFrameOrigin.value.copy(frame.origin);
    this.domainUniforms.uFrameNormal.value.copy(frame.normal);
    this.domainUniforms.uFrameTangentU.value.copy(frame.tangentU);
    this.domainUniforms.uFrameTangentV.value.copy(frame.tangentV);

    // Local camera coordinates are always the origin by construction (the
    // frame recentres on the camera every frame) — see SphereWaterDomain.
    const levels = computeWaterLodLevels(0, 0, this.gridOptions);

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

    // The Three.js render happens right after postTick$; flush these
    // template inputs now so orbitControls reaches the same frame.
    this.changeDetector.detectChanges();
  }

  /** See `/water-material-poc`'s identical method for why physical drawing-buffer pixels matter here. */
  private captureDepth(): void {
    const renderer = this.engine.renderer;
    if (!(renderer instanceof WebGLRenderer)) return;

    renderer.getDrawingBufferSize(this.drawingBufferSize);
    const width = this.drawingBufferSize.x;
    const height = this.drawingBufferSize.y;
    this.depthPrepass.setSize(width, height);
    this.depthPrepass.capture(
      renderer,
      this.engine.scene,
      this.engine.camera$.value,
      this.levelMeshes,
    );

    const camera = this.engine.camera$.value as PerspectiveCamera;
    for (const material of this.levelMaterials) {
      material.uniforms['uSceneDepthTexture'].value = this.depthPrepass.texture;
      material.uniforms['uResolution'].value.set(width, height);
      material.uniforms['uCameraNear'].value = camera.near;
      material.uniforms['uCameraFar'].value = camera.far;
    }
  }
}

/**
 * Ground sits `OCEAN_FLOOR_DEPTH_M` below the water radius everywhere except
 * a few raised islands, so shore-fade/depth-tint has real depth variation to
 * react to (matching the plane demo's sloped-shore role), rather than ground
 * and water sharing one radius everywhere.
 */
function createGroundGeometry(): SphereGeometry {
  const baseRadius = SPHERE_RADIUS_M - OCEAN_FLOOR_DEPTH_M;
  const geometry = new SphereGeometry(baseRadius, 96, 64);
  const position = geometry.attributes['position'];
  const direction = new Vector3();
  for (let i = 0; i < position.count; i++) {
    direction
      .set(position.getX(i), position.getY(i), position.getZ(i))
      .normalize();
    let bump = 0;
    for (const island of ISLANDS) {
      const cos = direction.dot(island.direction);
      const t = smoothstep(island.cosAngularRadius, 1, cos);
      bump = Math.max(bump, t * island.heightM);
    }
    const radius = baseRadius + bump;
    position.setXYZ(i, direction.x * radius, direction.y * radius, direction.z * radius);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}
