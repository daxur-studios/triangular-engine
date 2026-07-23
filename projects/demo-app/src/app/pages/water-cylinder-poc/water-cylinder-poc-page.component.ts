import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  Color,
  CylinderGeometry,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Vector3Tuple,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  CALM_LAKE_PRESET,
  CylinderWaterDomain,
  GERSTNER_DISPLACE_GLSL,
  GERSTNER_NORMAL_GLSL,
  GERSTNER_UNIFORMS_GLSL,
  OCEAN_SWELL_PRESET,
  STORM_PRESET,
  WATER_DEPTH_FADE_GLSL,
  WATER_DEPTH_UNPACK_GLSL,
  WATER_DETAIL_NORMAL_GLSL,
  WATER_DOMAIN_UNIFORMS_GLSL,
  WATER_FRESNEL_GLSL,
  WATER_LOGDEPTH_FRAGMENT_GLSL,
  WATER_LOGDEPTH_PARS_FRAGMENT_GLSL,
  WATER_LOGDEPTH_PARS_VERTEX_GLSL,
  WATER_LOGDEPTH_VERTEX_GLSL,
  WATER_SHADING_UNIFORMS_GLSL,
  WATER_SURFACE_DEPTH_GLSL,
  WATER_SURFACE_DEPTH_UNIFORMS_GLSL,
  WaterDepthPrepass,
  createGerstnerUniforms,
  createProceduralNormalMapTexture,
  createWaterDomainUniforms,
  createWaterShadingUniforms,
  createWaterSurfaceDepthUniforms,
  updateGerstnerUniforms,
  updateWaterSurfaceDepthCamera,
  type GerstnerUniforms,
  type WaterDomainUniforms,
  type WaterShadingUniforms,
  type WaterSurfaceDepthUniforms,
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

const CYLINDER_RADIUS_M = 500;
const CYLINDER_LENGTH_M = 1000;
const CYLINDER_CENTER = new Vector3(0, 0, 0);
const CYLINDER_AXIS = new Vector3(1, 0, 0);
const GROUND_ROTATION_RAD = -Math.PI / 2;

const BUMPS: ReadonlyArray<{
  readonly axialM: number;
  readonly angleRad: number;
  readonly radiusM: number;
  readonly heightM: number;
}> = [
  { axialM: -120, angleRad: 0, radiusM: 90, heightM: 14 },
  { axialM: 60, angleRad: 2.6, radiusM: 70, heightM: 10 },
  { axialM: 220, angleRad: -1.8, radiusM: 100, heightM: 16 },
];

const OCEAN_FLOOR_DEPTH_M = 6;

const VERTEX_SHADER = `
  ${WATER_LOGDEPTH_PARS_VERTEX_GLSL}
  ${GERSTNER_UNIFORMS_GLSL}
  ${GERSTNER_DISPLACE_GLSL}
  ${GERSTNER_NORMAL_GLSL}
  ${WATER_DOMAIN_UNIFORMS_GLSL}
  uniform float uTime;
  varying vec3 vLocalNormal;
  varying vec3 vWorldPosition;
  varying vec2 vSurfXZ;
  varying float vFragViewZ;

  void main() {
    float axial = position.x;
    float angle = atan(position.z, -position.y);
    vec2 surfXZ = vec2(axial, uCylinderRadius * angle);

    vec3 localDisplaced = gerstnerDisplace(surfXZ, uTime);
    vLocalNormal = gerstnerNormal(surfXZ, uTime);
    vSurfXZ = surfXZ;

    vec3 radialDir = length(position.yz) > 0.001 ? normalize(vec3(0.0, position.y, position.z)) : vec3(0.0, -1.0, 0.0);
    float displacedRadius = uCylinderRadius - localDisplaced.y;
    vec3 worldPos = vec3(axial, 0.0, 0.0) + radialDir * displacedRadius;
    vWorldPosition = worldPos;

    vec4 viewPos = viewMatrix * vec4(worldPos, 1.0);
    vFragViewZ = viewPos.z;
    gl_Position = projectionMatrix * viewPos;
    ${WATER_LOGDEPTH_VERTEX_GLSL}
  }
`;

const FRAGMENT_SHADER = `
  ${WATER_LOGDEPTH_PARS_FRAGMENT_GLSL}
  ${WATER_SHADING_UNIFORMS_GLSL}
  ${WATER_DETAIL_NORMAL_GLSL}
  ${WATER_FRESNEL_GLSL}
  ${WATER_DEPTH_UNPACK_GLSL}
  ${WATER_SURFACE_DEPTH_UNIFORMS_GLSL}
  ${WATER_SURFACE_DEPTH_GLSL}
  ${WATER_DEPTH_FADE_GLSL}
  ${WATER_DOMAIN_UNIFORMS_GLSL}
  uniform vec3 uLightDirection;
  uniform float uTime;
  uniform float uDetailEnabled;
  uniform float uShoreFadeEnabled;
  varying vec3 vLocalNormal;
  varying vec3 vWorldPosition;
  varying vec2 vSurfXZ;
  varying float vFragViewZ;

  void main() {
    vec3 localBase = normalize(vLocalNormal);
    vec3 localDetailed = waterDetailNormal(vSurfXZ, localBase, uTime);
    vec3 localMixed = normalize(mix(localBase, localDetailed, uDetailEnabled));

    vec3 fromAxis = vWorldPosition - uCylinderCenter;
    vec3 radial = fromAxis
      - uCylinderAxis * dot(fromAxis, uCylinderAxis);
    vec3 domainUp = -normalize(radial);
    vec3 tangentAround = normalize(cross(uCylinderAxis, domainUp));
    vec3 normal = normalize(
      uCylinderAxis * localMixed.x
      + domainUp * localMixed.y
      + tangentAround * localMixed.z
    );

    vec2 screenUV = gl_FragCoord.xy / uResolution;
    float depth = waterSurfaceDepth(screenUV, vWorldPosition, domainUp);
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

@Component({
  selector: 'app-water-cylinder-poc-page',
  imports: [RouterLink, EngineModule],
  templateUrl: './water-cylinder-poc-page.component.html',
  styleUrl: './water-cylinder-poc-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    EngineService.provide({
      showFPS: true,
      webGLRendererParameters: { logarithmicDepthBuffer: true },
    }),
  ],
  host: { class: 'flex-page' },
})
export class WaterCylinderPocPageComponent {
  readonly waterLevel = signal(10);
  readonly minWaterLevel = 2;
  readonly maxWaterLevel = 25;
  readonly presetKeys = Object.keys(PRESETS) as PresetKey[];
  readonly presetLabels = PRESET_LABELS;
  readonly activePreset = signal<PresetKey>('oceanSwell');
  readonly detailChop = signal(true);
  readonly shoreFade = signal(true);
  readonly wireframe = signal(false);

  readonly cylinderRadiusM = CYLINDER_RADIUS_M;
  readonly initialCameraPosition: Vector3Tuple;
  readonly initialTarget: Vector3Tuple;
  readonly initialUpVector: Vector3Tuple;

  private readonly engine = inject(EngineService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly domain = new CylinderWaterDomain(CYLINDER_RADIUS_M, {
    axis: CYLINDER_AXIS,
    center: CYLINDER_CENTER,
  });
  private readonly gerstnerUniforms: GerstnerUniforms;
  private readonly shadingUniforms: WaterShadingUniforms;
  private readonly surfaceDepthUniforms: WaterSurfaceDepthUniforms;
  private readonly domainUniforms: WaterDomainUniforms;
  private readonly uTime = { value: 0 };
  private readonly waterMesh: Mesh;
  private readonly waterMaterial: ShaderMaterial;
  private readonly groundMesh: Mesh;
  private readonly depthPrepass: WaterDepthPrepass;
  private readonly drawingBufferSize = new Vector2();

  constructor() {
    const destroyRef = inject(DestroyRef);
    const previousBackground = this.engine.scene.background;
    this.engine.scene.background = new Color('#04121c');

    const firstBump = BUMPS[0];
    const referencePoint = nativeCylinderPointToWorld(
      Math.cos(firstBump.angleRad) * (CYLINDER_RADIUS_M + 1),
      firstBump.axialM,
      Math.sin(firstBump.angleRad) * (CYLINDER_RADIUS_M + 1),
    );
    const startFrame = this.domain.getLocalFrame(referencePoint);
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
    this.surfaceDepthUniforms = createWaterSurfaceDepthUniforms();
    this.domainUniforms = createWaterDomainUniforms();
    this.domainUniforms.uCylinderCenter.value.copy(CYLINDER_CENTER);
    this.domainUniforms.uCylinderAxis.value.copy(CYLINDER_AXIS);
    this.domainUniforms.uCylinderRadius.value =
      CYLINDER_RADIUS_M - this.waterLevel();

    this.groundMesh = new Mesh(
      createGroundGeometry(),
      new MeshStandardMaterial({
        color: '#8f7a52',
        roughness: 0.95,
        side: DoubleSide,
      }),
    );
    this.engine.scene.add(this.groundMesh);

    const waterRadius = CYLINDER_RADIUS_M - this.waterLevel();
    const waterGeometry = new CylinderGeometry(
      waterRadius,
      waterRadius,
      CYLINDER_LENGTH_M,
      192,
      128,
      true,
    );
    waterGeometry.rotateZ(GROUND_ROTATION_RAD);

    this.waterMaterial = new ShaderMaterial({
      uniforms: {
        ...this.gerstnerUniforms,
        ...this.shadingUniforms,
        ...this.surfaceDepthUniforms,
        ...this.domainUniforms,
        uTime: this.uTime,
        uLightDirection: { value: new Vector3(0.4, 0.8, 0.3).normalize() },
        uDetailEnabled: { value: this.detailChop() ? 1 : 0 },
        uShoreFadeEnabled: { value: this.shoreFade() ? 1 : 0 },
      },
      defines: { WATER_DOMAIN_CYLINDER: '' },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      side: DoubleSide,
      transparent: true,
      depthWrite: false,
      wireframe: this.wireframe(),
    });

    this.waterMesh = new Mesh(waterGeometry, this.waterMaterial);
    this.engine.scene.add(this.waterMesh);

    this.depthPrepass = new WaterDepthPrepass(
      this.engine.width,
      this.engine.height,
    );

    destroyRef.onDestroy(() => {
      this.engine.scene.background = previousBackground;
      this.groundMesh.removeFromParent();
      this.groundMesh.geometry.dispose();
      (this.groundMesh.material as MeshStandardMaterial).dispose();

      this.waterMesh.removeFromParent();
      this.waterMesh.geometry.dispose();
      this.waterMaterial.dispose();

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
    this.waterMaterial.uniforms['uDetailEnabled'].value = this.detailChop()
      ? 1
      : 0;
  }

  toggleShoreFade(): void {
    this.shoreFade.update((v) => !v);
    this.waterMaterial.uniforms['uShoreFadeEnabled'].value = this.shoreFade()
      ? 1
      : 0;
  }

  toggleWireframe(): void {
    this.wireframe.update((v) => !v);
    this.waterMaterial.wireframe = this.wireframe();
    (this.groundMesh.material as MeshStandardMaterial).wireframe =
      this.wireframe();
  }

  setWaterLevel(value: number | string): void {
    const depth = Math.min(
      this.maxWaterLevel,
      Math.max(this.minWaterLevel, Number(value)),
    );
    this.waterLevel.set(depth);
    const newRadius = CYLINDER_RADIUS_M - depth;
    this.domainUniforms.uCylinderRadius.value = newRadius;

    this.waterMesh.geometry.dispose();
    const newGeometry = new CylinderGeometry(
      newRadius,
      newRadius,
      CYLINDER_LENGTH_M,
      192,
      128,
      true,
    );
    newGeometry.rotateZ(GROUND_ROTATION_RAD);
    this.waterMesh.geometry = newGeometry;
  }

  private tick(deltaTime: number): void {
    this.uTime.value = this.engine.clock.getElapsedTime();
    this.changeDetector.detectChanges();
  }

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
      [this.waterMesh],
    );

    const camera = this.engine.camera$.value as PerspectiveCamera;
    updateWaterSurfaceDepthCamera(this.surfaceDepthUniforms, camera);
    this.waterMaterial.uniforms['uSceneDepthTexture'].value =
      this.depthPrepass.texture;
    this.waterMaterial.uniforms['uResolution'].value.set(width, height);
    this.waterMaterial.uniforms['uCameraNear'].value = camera.near;
    this.waterMaterial.uniforms['uCameraFar'].value = camera.far;
  }
}

function createGroundGeometry(): CylinderGeometry {
  const baseRadius = CYLINDER_RADIUS_M - OCEAN_FLOOR_DEPTH_M;
  const geometry = new CylinderGeometry(
    baseRadius,
    baseRadius,
    CYLINDER_LENGTH_M,
    96,
    64,
    true,
  );
  const position = geometry.attributes['position'];
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const angle = Math.atan2(z, x);
    let bump = 0;
    for (const b of BUMPS) {
      const axialDelta = y - b.axialM;
      const angleDelta = Math.atan2(
        Math.sin(angle - b.angleRad),
        Math.cos(angle - b.angleRad),
      );
      const arcDelta = angleDelta * baseRadius;
      const dist = Math.sqrt(axialDelta * axialDelta + arcDelta * arcDelta);
      const t = smoothstep(b.radiusM, 0, dist);
      bump = Math.max(bump, t * b.heightM);
    }
    const radius = baseRadius - bump;
    position.setXYZ(i, Math.cos(angle) * radius, y, Math.sin(angle) * radius);
  }
  geometry.computeVertexNormals();
  geometry.rotateZ(GROUND_ROTATION_RAD);
  return geometry;
}

function nativeCylinderPointToWorld(
  nativeX: number,
  nativeY: number,
  nativeZ: number,
): Vector3 {
  const cos = Math.cos(GROUND_ROTATION_RAD);
  const sin = Math.sin(GROUND_ROTATION_RAD);
  return new Vector3(
    nativeX * cos - nativeY * sin,
    nativeX * sin + nativeY * cos,
    nativeZ,
  );
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}
