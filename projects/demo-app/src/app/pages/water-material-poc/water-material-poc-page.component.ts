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
  PlaneGeometry,
  ShaderMaterial,
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
  WATER_DEPTH_FADE_GLSL,
  WATER_DEPTH_UNPACK_GLSL,
  WATER_DETAIL_NORMAL_GLSL,
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
  createWaterLodPatchGeometry,
  createWaterShadingUniforms,
  updateGerstnerUniforms,
  type GerstnerUniforms,
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

/**
 * Ring count is the one grid parameter exposed as a runtime slider (see
 * `setRingCount`): each added ring roughly doubles the covered radius for a
 * fixed per-ring instance budget (CDLOD's whole point), so it's a cheap way
 * to push the "how far does the ocean extend" boundary out. It does not by
 * itself make the ocean infinite — see the runbook's still-unbuilt "far
 * skirt to the horizon line" note under Mesh/LOD.
 */
const BASE_GRID_OPTIONS = {
  baseCellSize: 4,
  patchResolution: 8,
  coreSizePatches: 16,
} as const;

const DEFAULT_RING_COUNT = 4;
const MIN_RING_COUNT = 1;
const MAX_RING_COUNT = 7;

const MAX_INSTANCES_PER_LEVEL =
  BASE_GRID_OPTIONS.coreSizePatches * BASE_GRID_OPTIONS.coreSizePatches;

/** Effectively "never" for the outermost level's outer cull test. */
const OUTER_CULL_SENTINEL = 1e9;

const VERTEX_SHADER = `
  ${WATER_LOGDEPTH_PARS_VERTEX_GLSL}
  ${GERSTNER_UNIFORMS_GLSL}
  ${GERSTNER_DISPLACE_GLSL}
  ${GERSTNER_NORMAL_GLSL}
  ${WATER_LOD_MORPH_GLSL}
  uniform float uTime;
  uniform float uCellSize;
  uniform float uMorphStart;
  uniform float uMorphEnd;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying float vFragViewZ;

  void main() {
    vec4 instanced = instanceMatrix * vec4(position, 1.0);
    vec4 worldPos4 = modelMatrix * instanced;
    vec2 base = waterLodMorph(worldPos4.xz, cameraPosition.xz, uCellSize, uMorphStart, uMorphEnd);

    vec3 displaced = gerstnerDisplace(base, uTime);
    vNormal = gerstnerNormal(base, uTime);
    vWorldPosition = displaced;

    vec4 viewPos = viewMatrix * vec4(displaced, 1.0);
    vFragViewZ = viewPos.z;
    gl_Position = projectionMatrix * viewPos;
    ${WATER_LOGDEPTH_VERTEX_GLSL}
  }
`;

const FRAGMENT_SHADER = `
  ${WATER_LOGDEPTH_PARS_FRAGMENT_GLSL}
  ${WATER_LOD_CULL_GLSL}
  ${WATER_SHADING_UNIFORMS_GLSL}
  ${WATER_DETAIL_NORMAL_GLSL}
  ${WATER_FRESNEL_GLSL}
  ${WATER_DEPTH_UNPACK_GLSL}
  ${WATER_DEPTH_FADE_GLSL}
  uniform vec3 uLightDirection;
  uniform float uInnerCullRadius;
  uniform float uOuterCullRadius;
  uniform float uTime;
  uniform float uDetailEnabled;
  uniform float uShoreFadeEnabled;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying float vFragViewZ;

  void main() {
    waterLodCull(vWorldPosition.xz, cameraPosition.xz, uInnerCullRadius, uOuterCullRadius);

    vec3 baseNormal = normalize(vNormal);
    vec3 detailed = waterDetailNormal(vWorldPosition.xz, baseNormal, uTime);
    vec3 normal = normalize(mix(baseNormal, detailed, uDetailEnabled));

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
 * Phase 1b material spike for triangular-engine/water
 * (docs/runbook/002_water_sublibrary.md): scrolling detail-normal chop,
 * fresnel, absorption colour, and depth-texture shoreline fade / depth tint,
 * layered on top of the Phase 1a LOD grid (unchanged) against a sloped
 * opaque "shore" mesh. The shore fade/tint reads a `WaterDepthPrepass`
 * capture of the opaque scene's depth (water hidden), taken each frame from
 * `EngineService.postTick$` — this is the spike that answers the runbook's
 * open question about depth-texture shading working outside the
 * postprocessing composer.
 */
@Component({
  selector: 'app-water-material-poc-page',
  imports: [RouterLink, EngineModule],
  templateUrl: './water-material-poc-page.component.html',
  styleUrl: './water-material-poc-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    EngineService.provide({
      showFPS: true,
      webGLRendererParameters: { logarithmicDepthBuffer: true },
    }),
  ],
  host: { class: 'flex-page' },
})
export class WaterMaterialPocPageComponent {
  readonly presetKeys = Object.keys(PRESETS) as PresetKey[];
  readonly presetLabels = PRESET_LABELS;
  readonly activePreset = signal<PresetKey>('oceanSwell');
  readonly detailChop = signal(true);
  readonly shoreFade = signal(true);
  readonly ringCount = signal(DEFAULT_RING_COUNT);
  readonly minRingCount = MIN_RING_COUNT;
  readonly maxRingCount = MAX_RING_COUNT;
  readonly outerExtentMeters = computed(() => {
    const halfCountPatches = BASE_GRID_OPTIONS.coreSizePatches / 2;
    const patchWorldSize =
      BASE_GRID_OPTIONS.baseCellSize * 2 ** this.ringCount();
    return Math.round(halfCountPatches * patchWorldSize);
  });

  readonly initialCameraPosition: Vector3Tuple = [70, 30, 110];
  readonly initialTarget: Vector3Tuple = [10, -2, 0];

  private readonly engine = inject(EngineService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly gerstnerUniforms: GerstnerUniforms;
  private readonly shadingUniforms: WaterShadingUniforms;
  private readonly uTime = { value: 0 };
  private readonly levelMeshes: InstancedMesh[] = [];
  private readonly levelMaterials: ShaderMaterial[] = [];
  private readonly scratchMatrix = new Matrix4();
  private readonly patchGeometry: BufferGeometry;
  private readonly shoreMesh: Mesh;
  private readonly depthPrepass: WaterDepthPrepass;
  private readonly drawingBufferSize = new Vector2();
  private gridOptions: WaterLodGridOptions;

  constructor() {
    const destroyRef = inject(DestroyRef);
    const previousBackground = this.engine.scene.background;
    this.engine.scene.background = new Color('#04121c');

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

    this.shoreMesh = new Mesh(
      createShoreGeometry(),
      new MeshStandardMaterial({ color: '#d9c48f', roughness: 0.95 }),
    );
    this.engine.scene.add(this.shoreMesh);

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
      this.shoreMesh.removeFromParent();
      this.shoreMesh.geometry.dispose();
      (this.shoreMesh.material as MeshStandardMaterial).dispose();
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

  /** Rebuilds the LOD grid at a new ring count — the level count itself changes, so this disposes and recreates every level's mesh/material rather than patching uniforms in place. */
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
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        side: DoubleSide,
        transparent: true,
        depthWrite: false,
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
    const levels = computeWaterLodLevels(
      camera.position.x,
      camera.position.z,
      this.gridOptions,
    );

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

  /**
   * Captures opaque scene depth (water hidden) for this frame's shore-fade/tint
   * sampling. Must be sized and sampled in physical framebuffer pixels
   * (`getDrawingBufferSize`), not `engine.width`/`height` (CSS pixels) — the
   * fragment shader's `gl_FragCoord` is always physical pixels, and dividing it
   * by a CSS-pixel resolution left `screenUV` running past 1.0 on any display
   * with devicePixelRatio > 1, sampling the depth texture's clamped edge
   * instead of the real depth almost everywhere.
   */
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
 * A single static sloped "shore": deep water on -X, dry beach on +X, a mild
 * along-shore ripple so the waterline isn't a perfectly straight edge.
 */
function createShoreGeometry(): PlaneGeometry {
  const geometry = new PlaneGeometry(400, 300, 80, 60);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes['position'];
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const t = smoothstep(-60, 80, x);
    const ripple = Math.sin(z * 0.05) * 1.5 * (1 - Math.abs(t - 0.5) * 2);
    position.setY(i, -14 + t * 22 + ripple);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}
