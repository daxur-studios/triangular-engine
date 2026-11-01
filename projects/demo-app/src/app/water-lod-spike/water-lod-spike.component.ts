import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  isDevMode,
  signal,
} from '@angular/core';
import { Color } from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import { FlatTerrainComponent } from 'triangular-engine/lod-surface';
import { TestRunnerComponent, type TestProgress, type TestRunAdapter, type TestSetting } from 'triangular-engine/testing';
import {
  createWaterLodSpikeScene,
  type IWaterLodSpikeSceneHandle,
} from './core';
import {
  createWaterLodSpikeTestAdapter,
  WATER_LOD_SPIKE_TEST_HISTORY,
  type WaterLodSpikeTestSettings,
} from './water-lod-spike-tests';

/**
 * Spike W0b (Plan 080, LOD Water): does analytic wave water on a flat plane
 * keep its near and far forms matched, with no colour step at handover and
 * no shimmer, within the plan 080 gates? The water is a 100 km
 * `<flatTerrain>` fed by the spike's 16-wave height source and its own
 * material (`core/`). Per-wave fade, roughness transfer, calm, slick and foam
 * are not built yet.
 *
 * What this file is responsible for and nothing more: providing
 * `EngineService` (so `<scene>` owns the renderer, camera, tick loop, resize
 * handling, and the free `showFPS` overlay), binding the water body, wiring UI
 * toggles through to the `core/` factory's handle, and hosting the test runner
 * (`water-lod-spike-tests.ts`).
 */
@Component({
  selector: 'app-water-lod-spike',
  imports: [EngineModule, FlatTerrainComponent, TestRunnerComponent],
  templateUrl: './water-lod-spike.component.html',
  styleUrl: './water-lod-spike.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    EngineService.provide({
      showFPS: true,
      preferredRenderer: 'webgpu',
      webGpuRendererParameters: { antialias: false, reversedDepthBuffer: true },
    }),
  ],
  host: { class: 'flex-page' },
})
export class WaterLodSpikeComponent {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  /** Plane edge length, metres (plan 080: 100 km flat plane). */
  protected readonly planeSizeM = 100_000;
  protected readonly water: IWaterLodSpikeSceneHandle;

  readonly testHistory = WATER_LOD_SPIKE_TEST_HISTORY;
  /** Autostart from a launch link is a dev-only convenience; the owner's dev server is in dev mode. */
  readonly allowTestAutoStart = isDevMode();
  readonly testAdapter: TestRunAdapter<WaterLodSpikeTestSettings, boolean>;

  readonly wireframe = signal(false);
  readonly drawCalls = signal(0);
  readonly triangles = signal(0);
  /** True once the water body has drawn, so a test case has something to look at. */
  readonly sceneReady = computed(() => this.drawCalls() > 0);
  /** True while a test case is measuring or warming up; drives the red outline on the scene. */
  readonly testing = signal(false);
  /** Frame intervals (ms) collected while a performance case measures; null when not sampling. */
  private frameTimes: number[] | null = null;
  private lastFrameMs = 0;

  /** GPU vendor from the WebGPU adapter, filled in once the adapter resolves. */
  private gpuVendor = 'unknown';

  constructor() {
    this.engine.scene.background = new Color('#12181f');
    this.water = createWaterLodSpikeScene(this.engine, (diagnostics) => {
      this.drawCalls.set(diagnostics.drawCalls);
      this.triangles.set(diagnostics.triangles);
    });
    this.destroyRef.onDestroy(() => this.water.dispose());
    const frameSubscription = this.engine.tick$.subscribe(() => {
      const nowMs = performance.now();
      if (this.frameTimes && this.lastFrameMs > 0) {
        this.frameTimes.push(nowMs - this.lastFrameMs);
      }
      this.lastFrameMs = nowMs;
    });
    this.destroyRef.onDestroy(() => frameSubscription.unsubscribe());
    this.testAdapter = createWaterLodSpikeTestAdapter({
      ready: () => this.sceneReady(),
      wireframe: () => this.water.material.wireframe,
      setWireframe: (enabled) => {
        this.wireframe.set(enabled);
        this.water.setWireframe(enabled);
      },
      counts: () => ({ drawCalls: this.drawCalls(), triangles: this.triangles() }),
      beginFrameSampling: () => {
        this.frameTimes = [];
        this.lastFrameMs = 0;
      },
      endFrameSampling: () => {
        const frames = this.frameTimes ?? [];
        this.frameTimes = null;
        return frames;
      },
      environment: () => this.environment(),
    });
    void navigator.gpu?.requestAdapter().then((adapter) => {
      this.gpuVendor = adapter?.info?.vendor || 'unknown';
    });
  }

  onTestProgress(progress: TestProgress | null): void {
    this.testing.set(progress?.phase === 'measuring' || progress?.phase === 'warmup');
  }

  toggleWireframe(): void {
    this.wireframe.update((enabled) => !enabled);
    this.water.setWireframe(this.wireframe());
  }

  private environment(): Readonly<Record<string, TestSetting>> {
    const renderer = this.engine.renderer as { isWebGPURenderer?: boolean };
    return {
      backend: renderer.isWebGPURenderer === true ? 'webgpu' : 'webgl',
      gpuVendor: this.gpuVendor,
      viewport: `${this.engine.renderer.domElement.width}x${this.engine.renderer.domElement.height}`,
    };
  }
}
