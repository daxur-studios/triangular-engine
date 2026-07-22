import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  inject,
  signal,
  type WritableSignal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  ShaderMaterial,
  Vector3,
  type Vector3Tuple,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  CALM_LAKE_PRESET,
  GERSTNER_DISPLACE_GLSL,
  GERSTNER_NORMAL_GLSL,
  GERSTNER_UNIFORMS_GLSL,
  GerstnerSurface,
  OCEAN_SWELL_PRESET,
  STORM_PRESET,
  WATER_LOD_MORPH_GLSL,
  computeWaterLodLevels,
  createGerstnerUniforms,
  createWaterLodPatchGeometry,
  updateGerstnerUniforms,
  type GerstnerUniforms,
  type WaterLodGridOptions,
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

/** Distinct per-level tint so ring boundaries are visible while debugging. */
const LEVEL_COLORS: readonly string[] = [
  '#8fe3ff',
  '#8fffb8',
  '#ffe98f',
  '#ffb48f',
  '#ff8fd6',
  '#c98fff',
];

const GRID_OPTIONS: WaterLodGridOptions = {
  baseCellSize: 4,
  patchResolution: 8,
  coreSizePatches: 16,
  ringCount: 4,
};

/** Max instances any level can need — the solid (non-hollow) block size. */
const MAX_INSTANCES_PER_LEVEL =
  GRID_OPTIONS.coreSizePatches * GRID_OPTIONS.coreSizePatches;

const FLYTHROUGH_SPEED = 30; // m/s

const VERTEX_SHADER = `
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
  varying float vMorph;

  void main() {
    vec4 instanced = instanceMatrix * vec4(position, 1.0);
    vec4 worldPos4 = modelMatrix * instanced;
    vec2 base = waterLodMorph(worldPos4.xz, cameraPosition.xz, uCellSize, uMorphStart, uMorphEnd);
    vMorph = clamp((distance(worldPos4.xz, cameraPosition.xz) - uMorphStart) / max(uMorphEnd - uMorphStart, 0.0001), 0.0, 1.0);

    vec3 displaced = gerstnerDisplace(base, uTime);
    vNormal = gerstnerNormal(base, uTime);
    vWorldPosition = displaced;
    gl_Position = projectionMatrix * viewMatrix * vec4(displaced, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  uniform vec3 uLightDirection;
  uniform vec3 uColorShallow;
  uniform vec3 uColorDeep;
  uniform vec3 uLevelTint;
  uniform float uLevelTintStrength;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying float vMorph;

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 lightDir = normalize(uLightDirection);
    float diffuse = max(dot(normal, lightDir), 0.0);
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
    vec3 base = mix(uColorDeep, uColorShallow, diffuse * 0.6 + 0.3);
    base = mix(base, uLevelTint, uLevelTintStrength);
    vec3 color = mix(base, vec3(1.0), fresnel * 0.35);
    gl_FragColor = vec4(color, 1.0);
  }
`;

/**
 * Phase 1a POC for triangular-engine/water (docs/runbook/002_water_sublibrary.md):
 * a CDLOD-style morphing clipmap proving large-scale, seam-free water LOD
 * before any material work lands on top of it. Each ring level is an
 * InstancedMesh sharing one patch geometry; `computeWaterLodLevels` (framework-
 * free, unit-tested) decides instance placement each frame from the camera's
 * world XZ, and the vertex shader morphs each patch's outer band toward the
 * next-coarser grid so ring boundaries never crack or pop.
 */
@Component({
  selector: 'app-water-lod-poc-page',
  imports: [RouterLink, EngineModule],
  templateUrl: './water-lod-poc-page.component.html',
  styleUrl: './water-lod-poc-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class WaterLodPocPageComponent {
  readonly presetKeys = Object.keys(PRESETS) as PresetKey[];
  readonly presetLabels = PRESET_LABELS;
  readonly activePreset = signal<PresetKey>('oceanSwell');
  readonly wireframe = signal(false);
  readonly flythrough = signal(false);
  readonly showGrid = signal(true);
  readonly instanceCount = signal(0);
  readonly triangleCount = signal(0);

  readonly flythroughDelta: WritableSignal<Vector3Tuple> = signal([0, 0, 0]);

  // Stable references: this page calls detectChanges() every engine tick to
  // flush moveBy, which re-evaluates the whole template. Inline array
  // literals in the template (`[cameraPosition]="[0, 60, 90]"`) would create
  // a *new* array every tick, and orbitControls treats any new reference as
  // an authoritative reset — snapping the camera back and fighting zoom/pan.
  readonly initialCameraPosition: Vector3Tuple = [0, 60, 90];
  readonly initialTarget: Vector3Tuple = [0, 0, 0];

  private readonly engine = inject(EngineService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly gerstnerUniforms: GerstnerUniforms;
  private readonly uTime = { value: 0 };
  private readonly levelMeshes: InstancedMesh[] = [];
  private readonly levelMaterials: ShaderMaterial[] = [];
  private readonly scratchMatrix = new Matrix4();
  private readonly halfCountPatches = GRID_OPTIONS.coreSizePatches / 2;

  constructor() {
    const destroyRef = inject(DestroyRef);
    const previousBackground = this.engine.scene.background;
    this.engine.scene.background = new Color('#04121c');
    destroyRef.onDestroy(() => {
      this.engine.scene.background = previousBackground;
      for (const mesh of this.levelMeshes) {
        mesh.removeFromParent();
        mesh.dispose();
      }
      for (const material of this.levelMaterials) {
        material.dispose();
      }
      this.patchGeometry.dispose();
    });

    this.gerstnerUniforms = createGerstnerUniforms(
      PRESETS[this.activePreset()].waves,
    );

    for (let level = 0; level <= GRID_OPTIONS.ringCount; level++) {
      const patchWorldSize = GRID_OPTIONS.baseCellSize * 2 ** level;
      const outerHalfExtent = this.halfCountPatches * patchWorldSize;
      const isOutermost = level === GRID_OPTIONS.ringCount;
      // The next level's ring hole is shrunk by one coarse patch (see
      // water-lod-grid.ts) to guarantee no gaps, plus each level snaps its
      // centre independently so the two can drift by up to ~1.5 coarse
      // patches. Together the coarser neighbour's coverage can reach ~3.5
      // coarse patches inside this level's true outer edge. Morphing must
      // fully complete (reach the coarser grid) before that band starts, or
      // both levels render independently-animated surfaces in the same
      // place — visible as intersecting waves in shaded mode.
      const overlapGuardM = isOutermost ? 0 : 4 * patchWorldSize;
      const morphEnd = Math.max(outerHalfExtent - overlapGuardM, patchWorldSize);
      const morphStart = Math.max(morphEnd - 2 * patchWorldSize, 0);
      const material = new ShaderMaterial({
        uniforms: {
          ...this.gerstnerUniforms,
          uTime: this.uTime,
          uCellSize: {
            value: patchWorldSize / GRID_OPTIONS.patchResolution,
          },
          uMorphStart: { value: morphStart },
          uMorphEnd: { value: morphEnd },
          uLightDirection: { value: new Vector3(0.4, 0.8, 0.3).normalize() },
          uColorShallow: { value: new Color('#8fe3ff') },
          uColorDeep: { value: new Color('#04283f') },
          uLevelTint: { value: new Color(LEVEL_COLORS[level % LEVEL_COLORS.length]) },
          uLevelTintStrength: { value: 0 },
        },
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: level,
        polygonOffsetUnits: level,
      });
      this.levelMaterials.push(material);

      const mesh = new InstancedMesh(this.patchGeometry, material, MAX_INSTANCES_PER_LEVEL);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.engine.scene.add(mesh);
      this.levelMeshes.push(mesh);
    }

    this.engine.tick$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((deltaTime) => this.tick(deltaTime));
  }

  private readonly patchGeometry = createWaterLodPatchGeometry(GRID_OPTIONS.patchResolution);

  selectPreset(key: PresetKey): void {
    if (key === this.activePreset()) return;
    this.activePreset.set(key);
    updateGerstnerUniforms(this.gerstnerUniforms, PRESETS[key].waves);
  }

  toggleWireframe(): void {
    this.wireframe.update((v) => !v);
    for (const material of this.levelMaterials) {
      material.wireframe = this.wireframe();
    }
  }

  toggleLevelTint(): void {
    const strength = this.levelMaterials[0]?.uniforms['uLevelTintStrength'].value > 0 ? 0 : 0.18;
    for (const material of this.levelMaterials) {
      material.uniforms['uLevelTintStrength'].value = strength;
    }
  }

  toggleFlythrough(): void {
    this.flythrough.update((v) => !v);
  }

  toggleGrid(): void {
    this.showGrid.update((v) => !v);
  }

  private tick(deltaTime: number): void {
    const t = this.engine.clock.getElapsedTime();
    this.uTime.value = t;

    if (this.flythrough()) {
      this.flythroughDelta.set([FLYTHROUGH_SPEED * deltaTime, 0, 0]);
    } else if (this.flythroughDelta()[0] !== 0) {
      this.flythroughDelta.set([0, 0, 0]);
    }

    const camera = this.engine.camera$.value;
    const levels = computeWaterLodLevels(
      camera.position.x,
      camera.position.z,
      GRID_OPTIONS,
    );

    let totalInstances = 0;
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      const mesh = this.levelMeshes[i];
      mesh.count = level.instances.length;
      for (let j = 0; j < level.instances.length; j++) {
        const instance = level.instances[j];
        this.scratchMatrix.makeScale(level.patchWorldSize, 1, level.patchWorldSize);
        this.scratchMatrix.setPosition(instance.x, 0, instance.z);
        mesh.setMatrixAt(j, this.scratchMatrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      totalInstances += level.instances.length;
    }

    this.instanceCount.set(totalInstances);
    this.triangleCount.set(
      totalInstances * GRID_OPTIONS.patchResolution * GRID_OPTIONS.patchResolution * 2,
    );

    // The Three.js render happens right after tick$; flush these template
    // inputs now so orbitControls' moveBy reaches the same frame.
    this.changeDetector.detectChanges();
  }
}
