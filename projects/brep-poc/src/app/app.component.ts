import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Color } from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import { buildBracket, type BuiltPart } from './part/bracket';
import { loadBrep, type BrepApi } from './part/brep-kernel';
import {
  DEFAULT_PART_PARAMETERS,
  PART_PARAMETER_CONTROLS,
  type PartParameterControl,
  type PartParameters,
} from './part/part-parameters';
import { createPartScene, type PartSceneHandle } from './scene/part-scene';

/** Wait after the last slider change before rebuilding, so dragging is not one build per pixel. */
const REBUILD_DEBOUNCE_MS = 120;
/** Tessellation tolerance while the user is still dragging, in millimetres. */
const PREVIEW_TOLERANCE_MM = 0.4;
/** Tessellation tolerance once the parameters settle, in millimetres. */
const FINAL_TOLERANCE_MM = 0.08;

type KernelState = 'loading' | 'ready' | 'error';

/**
 * POC shell: owns the `<scene>`, the kernel load and the debounced rebuild
 * loop, and nothing about geometry itself (that lives in `part/` and
 * `scene/`).
 */
@Component({
  selector: 'app-root',
  imports: [EngineModule, DecimalPipe],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class AppComponent {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly scene: PartSceneHandle;

  private brep: BrepApi | null = null;
  private lastPart: BuiltPart | null = null;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;

  readonly controls = PART_PARAMETER_CONTROLS;
  readonly params = signal<PartParameters>({ ...DEFAULT_PART_PARAMETERS });
  readonly kernelState = signal<KernelState>('loading');
  readonly busy = signal(true);
  readonly error = signal<string | null>(null);
  readonly edgesVisible = signal(true);
  readonly partInfo = signal<{
    readonly buildMs: number;
    readonly triangleCount: number;
    readonly volumeMm3: number;
    readonly filletApplied: boolean;
    readonly note: string | null;
  } | null>(null);

  readonly volumeCm3 = computed(() => {
    const info = this.partInfo();
    return info ? info.volumeMm3 / 1000 : 0;
  });

  constructor() {
    this.engine.scene.background = new Color('#0e141a');
    this.scene = createPartScene(this.engine);
    this.destroyRef.onDestroy(() => {
      if (this.rebuildTimer !== null) {
        clearTimeout(this.rebuildTimer);
      }
      this.scene.dispose();
    });
    void this.startKernel();
  }

  onSliderInput(control: PartParameterControl, event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = input.valueAsNumber;
    if (!Number.isFinite(value)) {
      return;
    }
    this.params.update((current) => ({ ...current, [control.key]: value }));
    this.scheduleRebuild();
  }

  toggleEdges(): void {
    this.edgesVisible.update((visible) => !visible);
    this.scene.setEdgesVisible(this.edgesVisible());
  }

  async exportPart(format: 'step' | 'stl'): Promise<void> {
    const part = this.lastPart;
    if (!part) {
      return;
    }
    const blob = format === 'step' ? await part.exportStep() : await part.exportStl();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bracket.${format}`;
    link.click();
    URL.revokeObjectURL(url);
  }

  private async startKernel(): Promise<void> {
    try {
      this.brep = await loadBrep();
      this.kernelState.set('ready');
      this.rebuild(PREVIEW_TOLERANCE_MM);
      this.rebuildTimer = setTimeout(() => this.rebuild(FINAL_TOLERANCE_MM), 0);
    } catch (error) {
      this.kernelState.set('error');
      this.error.set(error instanceof Error ? error.message : String(error));
      this.busy.set(false);
    }
  }

  private scheduleRebuild(): void {
    this.busy.set(true);
    if (this.rebuildTimer !== null) {
      clearTimeout(this.rebuildTimer);
    }
    this.rebuildTimer = setTimeout(() => this.rebuild(FINAL_TOLERANCE_MM), REBUILD_DEBOUNCE_MS);
  }

  private rebuild(toleranceMm: number): void {
    const brep = this.brep;
    if (!brep) {
      return;
    }
    try {
      const part = buildBracket(brep, this.params(), toleranceMm);
      this.lastPart = part;
      this.scene.setPart(part.geometry);
      this.partInfo.set({
        buildMs: part.buildMs,
        triangleCount: part.triangleCount,
        volumeMm3: part.volumeMm3,
        filletApplied: part.filletApplied,
        note: part.note,
      });
      this.error.set(null);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.busy.set(false);
    }
  }
}
