import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import type { ParamDefs } from 'brepjs';
import { Color } from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import { renderBracket, type RenderedPart } from './part/bracket-render';
import { loadBrep, type BrepApi } from './part/brep-kernel';
import { createPartScene, type PartSceneHandle } from './scene/part-scene';

/** The lazily loaded part module; also the file `brep verify` checks. */
type PartModule = typeof import('./part/bracket.brep');

/** The declared parameter values a build takes. */
type PartValues = PartModule['params']['values'];

/** Wait after the last slider change before rebuilding, so dragging is not one build per pixel. */
const REBUILD_DEBOUNCE_MS = 120;
/** Tessellation tolerance while the part is first drawn, in millimetres. */
const PREVIEW_TOLERANCE_MM = 0.4;
/** Tessellation tolerance once the parameters settle, in millimetres. */
const FINAL_TOLERANCE_MM = 0.08;
/** Fallback slider range when a numeric parameter declares no bounds. */
const DEFAULT_SLIDER_MIN = 0;
const DEFAULT_SLIDER_MAX = 100;
const DEFAULT_SLIDER_STEP = 1;

type KernelState = 'loading' | 'ready' | 'error';

/** One numeric row in the parameter panel. */
interface SliderControl {
  readonly key: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
}

/**
 * POC shell: owns the `<scene>`, the kernel load and the debounced rebuild
 * loop. The part itself (and its declared parameters) lives in
 * `part/bracket.brep.ts`, which `brep verify` runs on its own.
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
  private partModule: PartModule | null = null;
  private lastPart: RenderedPart | null = null;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;

  readonly controls = signal<readonly SliderControl[]>([]);
  readonly values = signal<PartValues | null>(null);
  readonly kernelState = signal<KernelState>('loading');
  readonly busy = signal(true);
  readonly error = signal<string | null>(null);
  readonly edgesVisible = signal(true);
  readonly liveShapes = signal(0);
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
      this.lastPart?.solid.delete();
      this.scene.dispose();
    });
    void this.startKernel();
  }

  /** Current value of a slider, or the declared default before the part loads. */
  valueOf(control: SliderControl): number {
    const values = this.values();
    return values ? asNumberMap(values)[control.key] ?? control.default : control.default;
  }

  onSliderInput(control: SliderControl, event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = input.valueAsNumber;
    if (!Number.isFinite(value)) {
      return;
    }
    this.values.update((current) =>
      current ? ({ ...asNumberMap(current), [control.key]: value } as PartValues) : current,
    );
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
      // One lazy chunk: the kernel and the part that runs on it.
      const [brep, part] = await Promise.all([loadBrep(), import('./part/bracket.brep')]);
      this.brep = brep;
      this.partModule = part;
      this.values.set({ ...part.params.values });
      this.controls.set(toSliderControls(part.params.defs));
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
    const partModule = this.partModule;
    const values = this.values();
    if (!brep || !partModule || !values) {
      return;
    }
    const startedAt = performance.now();
    try {
      const rendered = renderBracket(brep, partModule.buildBracket(values), toleranceMm);
      this.lastPart?.solid.delete();
      this.lastPart = rendered;
      this.scene.setPart(rendered.geometry);
      this.partInfo.set({
        buildMs: performance.now() - startedAt,
        triangleCount: rendered.triangleCount,
        volumeMm3: rendered.volumeMm3,
        filletApplied: rendered.filletApplied,
        note: rendered.note,
      });
      this.liveShapes.set(brep.getDisposalStats().liveHandles);
      this.error.set(null);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.busy.set(false);
    }
  }
}

/** Turn declared numeric parameters into panel rows, in declaration order. */
function toSliderControls(defs: ParamDefs): SliderControl[] {
  const controls: SliderControl[] = [];
  for (const [key, def] of Object.entries(defs)) {
    if (def.type !== 'number') {
      continue;
    }
    controls.push({
      key,
      label: def.label ?? key,
      min: def.min ?? DEFAULT_SLIDER_MIN,
      max: def.max ?? DEFAULT_SLIDER_MAX,
      step: def.step ?? DEFAULT_SLIDER_STEP,
      default: def.default,
    });
  }
  return controls;
}

/** Read a declared parameter set by name, for the panel's generic slider loop. */
function asNumberMap(values: PartValues): Record<string, number> {
  return values as unknown as Record<string, number>;
}
