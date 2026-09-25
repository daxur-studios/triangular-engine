import {
  AfterViewInit,
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  isDevMode,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { BufferGeometry, Color, DirectionalLight, HemisphereLight, Material } from 'three';
import {
  EngineModule,
  EngineService,
  InstancedMeshComponent,
  type IInstancedMeshData,
} from 'triangular-engine';
import { PerfHarness, type PerfBridge } from '../../testing/perf-harness/perf-harness';
import { PERF_SCENARIOS, type PerfScenarioHost } from '../../testing/perf-harness/perf-scenarios';

interface ComponentMount {
  geometry: BufferGeometry;
  material: Material;
  data: IInstancedMeshData[];
}

/**
 * Hosts the deterministic performance scenarios measured by
 * `tests/perf` (see `tests/perf/README.md`).
 *
 * `?perfTest=1` in a dev build exposes `window.__perfTest` for Playwright and
 * hides the panel; otherwise the page is a manual viewer for the same
 * workloads. Production builds never expose the bridge.
 */
@Component({
  selector: 'app-perf-lab-page',
  imports: [RouterLink, EngineModule],
  templateUrl: './perf-lab-page.component.html',
  styleUrl: './perf-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // pixelRatio 1 keeps the drawing buffer identical across machines.
  providers: [EngineService.provide({ showFPS: true, pixelRatio: 1 })],
  host: { class: 'flex-page' },
})
export class PerfLabPageComponent implements AfterViewInit {
  private readonly engine = inject(EngineService);
  private readonly appRef = inject(ApplicationRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly perfTestMode =
    isDevMode() && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('perfTest') === '1';
  readonly scenarios = PERF_SCENARIOS;
  readonly selectedId = signal('instanced-static');
  readonly selectedDescription = computed(() => PERF_SCENARIOS.find((scenario) => scenario.id === this.selectedId())?.description ?? '');
  readonly status = signal('');
  readonly componentMount = signal<ComponentMount | null>(null);

  private readonly instancedMeshComponent = viewChild(InstancedMeshComponent);
  private harness?: PerfHarness;

  constructor() {
    const previousBackground = this.engine.scene.background;
    this.engine.scene.background = new Color('#09111f');
    const key = new DirectionalLight('#ffffff', 2.2);
    key.position.set(30, 60, 20);
    const fill = new HemisphereLight('#bae6fd', '#0f172a', 0.8);
    this.engine.scene.add(key, fill);

    this.destroyRef.onDestroy(() => {
      this.harness?.destroy();
      this.engine.scene.remove(key, fill);
      this.engine.scene.background = previousBackground;
      delete (window as Window & { __perfTest?: PerfBridge }).__perfTest;
    });
  }

  ngAfterViewInit(): void {
    this.harness = new PerfHarness(this.engine, this.createHost());
    if (this.perfTestMode) {
      (window as Window & { __perfTest?: PerfBridge }).__perfTest = this.harness;
    } else {
      void this.loadSelected();
    }
  }

  onScenarioChange(event: Event): void {
    this.selectedId.set((event.target as HTMLSelectElement).value);
    void this.loadSelected();
  }

  private async loadSelected(): Promise<void> {
    if (!this.harness) return;
    this.status.set('Loading…');
    try {
      const result = await this.harness.load(this.selectedId());
      const failed = result.facts.checks.filter((check) => !check.pass).map((check) => check.name);
      this.status.set(
        `setup ${result.setupMs.toFixed(1)} ms · first frame ${result.firstFrameMs.toFixed(1)} ms · ` +
          `draw calls ${result.facts.frame.drawCalls}` +
          (failed.length ? ` · failing checks: ${failed.join(', ')}` : ''),
      );
    } catch (error) {
      this.status.set(error instanceof Error ? error.message : String(error));
    }
  }

  private createHost(): PerfScenarioHost {
    return {
      mountInstancedMeshComponent: async (options) => {
        this.componentMount.set(options);
        await this.appRef.whenStable();
        const component = this.instancedMeshComponent();
        if (!component) throw new Error('RUNTIME_ERROR: <instancedMesh> did not mount');
        return component;
      },
      unmountInstancedMeshComponent: async () => {
        this.componentMount.set(null);
        await this.appRef.whenStable();
      },
    };
  }
}
