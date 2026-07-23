import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  Color,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  WebGLRenderer,
  type Vector3Tuple,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  PlaneWaterDomain,
  WATER_RENDER_PRESETS,
  WATER_WAVE_PRESETS,
  WaterSurfaceRenderer,
  resolveWaterRenderPreset,
  type WaterRenderPreset,
} from 'triangular-engine/water';

type RenderPresetKey = keyof typeof WATER_RENDER_PRESETS;
type WavePresetKey = keyof typeof WATER_WAVE_PRESETS;

const PRESET_KEYS: readonly RenderPresetKey[] = [
  'performance',
  'balanced',
  'cinematic',
];

const PRESET_LABELS: Readonly<Record<RenderPresetKey, string>> = {
  performance: 'Performance',
  balanced: 'Balanced',
  cinematic: 'Cinematic',
};

const WAVE_PRESET_KEYS: readonly WavePresetKey[] = [
  'calmLake',
  'oceanSwell',
  'storm',
];

const WAVE_PRESET_LABELS: Readonly<Record<WavePresetKey, string>> = {
  calmLake: 'Calm',
  oceanSwell: 'Wavy',
  storm: 'Storm',
};

const DEFAULT_RING_COUNT = 5;
const MIN_RING_COUNT = 1;
const MAX_RING_COUNT = 7;

/**
 * Visual integration harness for the shared framework-free water renderer.
 * This page owns only its shore, camera and UI; all water geometry, shaders,
 * uniforms, depth capture and quality behavior live in WaterSurfaceRenderer.
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
  readonly presetKeys = PRESET_KEYS;
  readonly presetLabels = PRESET_LABELS;
  readonly wavePresetKeys = WAVE_PRESET_KEYS;
  readonly wavePresetLabels = WAVE_PRESET_LABELS;
  readonly activeQuality = signal<RenderPresetKey>('balanced');
  readonly activeWaves = signal<WavePresetKey>('oceanSwell');
  readonly detailChop = signal(true);
  readonly shoreFade = signal(true);
  readonly wireframe = signal(false);
  readonly ringCount = signal(DEFAULT_RING_COUNT);
  readonly minRingCount = MIN_RING_COUNT;
  readonly maxRingCount = MAX_RING_COUNT;
  readonly outerExtentMeters = computed(() => {
    const grid = WATER_RENDER_PRESETS[this.activeQuality()].grid;
    return Math.round(
      (grid.coreSizePatches / 2) *
        grid.baseCellSize *
        2 ** this.ringCount(),
    );
  });

  readonly initialCameraPosition: Vector3Tuple = [70, 30, 110];
  readonly initialTarget: Vector3Tuple = [10, -2, 0];

  private readonly engine = inject(EngineService);
  private readonly shoreMesh: Mesh;
  private readonly water: WaterSurfaceRenderer;

  constructor() {
    const destroyRef = inject(DestroyRef);
    const previousBackground = this.engine.scene.background;
    this.engine.scene.background = new Color('#04121c');

    this.shoreMesh = new Mesh(
      createShoreGeometry(),
      new MeshStandardMaterial({ color: '#d9c48f', roughness: 0.95 }),
    );
    this.engine.scene.add(this.shoreMesh);

    this.water = new WaterSurfaceRenderer({
      domain: new PlaneWaterDomain(),
      preset: this.resolveActivePreset(),
    });
    this.water.addTo(this.engine.scene);

    this.engine.tick$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe(() =>
        this.water.update(
          this.engine.camera$.value,
          this.engine.clock.getElapsedTime(),
        ),
      );
    this.engine.postTick$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe(() => this.captureDepth());

    destroyRef.onDestroy(() => {
      this.engine.scene.background = previousBackground;
      this.water.dispose();
      this.shoreMesh.removeFromParent();
      this.shoreMesh.geometry.dispose();
      (this.shoreMesh.material as MeshStandardMaterial).dispose();
    });
  }

  selectPreset(key: RenderPresetKey): void {
    if (key === this.activeQuality()) return;
    this.activeQuality.set(key);
    this.applyPreset();
  }

  selectWaves(key: WavePresetKey): void {
    if (key === this.activeWaves()) return;
    this.activeWaves.set(key);
    this.applyPreset();
  }

  toggleDetailChop(): void {
    this.detailChop.update((value) => !value);
    this.applyPreset();
  }

  toggleShoreFade(): void {
    this.shoreFade.update((value) => !value);
    this.applyPreset();
  }

  toggleWireframe(): void {
    this.wireframe.update((value) => !value);
    this.water.setWireframe(this.wireframe());
    (this.shoreMesh.material as MeshStandardMaterial).wireframe =
      this.wireframe();
  }

  setRingCount(value: number | string): void {
    const clamped = Math.min(
      MAX_RING_COUNT,
      Math.max(MIN_RING_COUNT, Math.round(Number(value))),
    );
    if (clamped === this.ringCount()) return;
    this.ringCount.set(clamped);
    this.applyPreset();
  }

  private applyPreset(): void {
    this.water.setPreset(this.resolveActivePreset());
  }

  private resolveActivePreset(): WaterRenderPreset {
    const base: WaterRenderPreset =
      WATER_RENDER_PRESETS[this.activeQuality()];
    return resolveWaterRenderPreset(base, {
      waves: WATER_WAVE_PRESETS[this.activeWaves()],
      grid: { ringCount: this.ringCount() },
      shading: {
        detailStrength: this.detailChop()
          ? base.shading.detailStrength
          : 0,
        // A tiny distance reaches full opacity immediately, effectively
        // disabling only shoreline fade while retaining depth tint.
        shoreFadeDistance: this.shoreFade()
          ? base.shading.shoreFadeDistance
          : 0.0001,
      },
    });
  }

  private captureDepth(): void {
    const renderer = this.engine.renderer;
    if (!(renderer instanceof WebGLRenderer)) return;
    this.water.captureDepth(
      renderer,
      this.engine.scene,
      this.engine.camera$.value,
    );
  }
}

/**
 * A static sloped shore: deep water on -X, dry beach on +X, with a mild
 * along-shore ripple so depth tint and shoreline fading are easy to inspect.
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
