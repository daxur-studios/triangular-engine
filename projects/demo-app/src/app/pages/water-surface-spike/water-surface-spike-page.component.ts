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
import { MatTooltip } from '@angular/material/tooltip';
import {
  Color,
  DoubleSide,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type QuaternionTuple,
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
  createGerstnerUniforms,
  updateGerstnerUniforms,
  type GerstnerUniforms,
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

/** Fixed world XZ "mooring points" each buoy is sampled at every frame. */
const BUOY_ANCHORS: readonly [number, number][] = [
  [8, 4],
  [-11, -6],
  [16, -13],
  [-7, 11],
  [0, 0],
];

const UP = new Vector3(0, 1, 0);

interface Buoy {
  readonly baseX: number;
  readonly baseZ: number;
  readonly position: WritableSignal<Vector3Tuple>;
  readonly quaternion: WritableSignal<QuaternionTuple>;
}

const VERTEX_SHADER = `
  ${GERSTNER_UNIFORMS_GLSL}
  ${GERSTNER_DISPLACE_GLSL}
  ${GERSTNER_NORMAL_GLSL}
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;

  void main() {
    vec2 base = position.xz;
    vec3 displaced = gerstnerDisplace(base, uTime);
    vNormal = gerstnerNormal(base, uTime);
    vec4 worldPosition = modelMatrix * vec4(displaced, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const FRAGMENT_SHADER = `
  uniform vec3 uLightDirection;
  uniform vec3 uColorShallow;
  uniform vec3 uColorDeep;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 lightDir = normalize(uLightDirection);
    float diffuse = max(dot(normal, lightDir), 0.0);
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
    vec3 base = mix(uColorDeep, uColorShallow, diffuse * 0.6 + 0.3);
    vec3 color = mix(base, vec3(1.0), fresnel * 0.35);
    gl_FragColor = vec4(color, 1.0);
  }
`;

/**
 * Phase 0 spike for the triangular-engine/water sub-library
 * (docs/runbook/002_water_sublibrary.md). Proves the single-WaterSurface-
 * model premise: the plane's vertices are GPU-displaced by
 * `gerstnerDisplace`/`gerstnerNormal`, and the buoys are CPU-positioned by
 * `GerstnerSurface.getHeight`/`getNormal` using the exact same resolved wave
 * list and the same elapsed time — if the model were inconsistent between
 * TS and GLSL, the buoys would visibly float above or sink below the mesh.
 */
@Component({
  selector: 'app-water-surface-spike-page',
  imports: [RouterLink, EngineModule, MatTooltip],
  templateUrl: './water-surface-spike-page.component.html',
  styleUrl: './water-surface-spike-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class WaterSurfaceSpikePageComponent {
  readonly presetKeys = Object.keys(PRESETS) as PresetKey[];
  readonly presetLabels = PRESET_LABELS;
  readonly activePreset = signal<PresetKey>('oceanSwell');

  readonly waterGeometry: PlaneGeometry;
  readonly waterMaterial: ShaderMaterial;

  readonly buoys: readonly Buoy[] = BUOY_ANCHORS.map(([baseX, baseZ]) => ({
    baseX,
    baseZ,
    position: signal<Vector3Tuple>([baseX, 0, baseZ]),
    quaternion: signal<QuaternionTuple>([0, 0, 0, 1]),
  }));

  private readonly engine = inject(EngineService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly gerstnerUniforms: GerstnerUniforms;
  private surface: GerstnerSurface;
  private readonly scratchNormal = new Vector3();
  private readonly scratchQuaternion = new Quaternion();

  constructor() {
    const destroyRef = inject(DestroyRef);
    const previousBackground = this.engine.scene.background;
    this.engine.scene.background = new Color('#04121c');
    destroyRef.onDestroy(() => {
      this.engine.scene.background = previousBackground;
    });

    this.surface = new GerstnerSurface(PRESETS[this.activePreset()].waves);
    this.gerstnerUniforms = createGerstnerUniforms(
      PRESETS[this.activePreset()].waves,
    );

    this.waterGeometry = new PlaneGeometry(80, 80, 220, 220);
    this.waterGeometry.rotateX(-Math.PI * 0.5);

    this.waterMaterial = new ShaderMaterial({
      uniforms: {
        ...this.gerstnerUniforms,
        uTime: { value: 0 },
        uLightDirection: { value: new Vector3(0.4, 0.8, 0.3).normalize() },
        uColorShallow: { value: new Color('#8fe3ff') },
        uColorDeep: { value: new Color('#04283f') },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      side: DoubleSide,
    });

    this.engine.tick$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe(() => this.tick());
  }

  selectPreset(key: PresetKey): void {
    if (key === this.activePreset()) return;
    this.activePreset.set(key);
    const waves = PRESETS[key].waves;
    this.surface = new GerstnerSurface(waves);
    updateGerstnerUniforms(this.gerstnerUniforms, waves);
  }

  private tick(): void {
    const t = this.engine.clock.getElapsedTime();
    this.waterMaterial.uniforms['uTime'].value = t;

    for (const buoy of this.buoys) {
      const height = this.surface.getHeight(buoy.baseX, buoy.baseZ, t);
      buoy.position.set([buoy.baseX, height, buoy.baseZ]);

      this.surface.getNormal(buoy.baseX, buoy.baseZ, t, this.scratchNormal);
      this.scratchQuaternion.setFromUnitVectors(UP, this.scratchNormal);
      buoy.quaternion.set(this.scratchQuaternion.toArray() as QuaternionTuple);
    }

    // The Three.js render happens right after tick$; flush these template
    // inputs now so the buoys and the displaced mesh reach the same frame.
    this.changeDetector.detectChanges();
  }
}
